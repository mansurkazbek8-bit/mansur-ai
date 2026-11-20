<?php

namespace Tests\Feature;

use App\Models\AiModel;
use App\Models\User;
use App\Services\Providers;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ImagePromptTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Providers::flush();
        Storage::fake('public');
    }

    /** Text model answers with $translation, image endpoint returns a JPEG. */
    private function fakeProviders(string $translation): void
    {
        Http::fake([
            'text.pollinations.ai/*' => Http::response(['choices' => [['message' => ['role' => 'assistant', 'content' => $translation]]]]),
            'image.pollinations.ai/*' => Http::response('jpeg-bytes', 200, ['Content-Type' => 'image/jpeg']),
        ]);
    }

    private function chat(User $user): array
    {
        AiModel::create(['slug' => 'chat', 'name' => 'Chat', 'provider' => 'pollinations', 'model' => 'openai-fast', 'type' => 'text', 'daily_limit' => 10]);
        $image = AiModel::create(['slug' => 'img', 'name' => 'Image', 'provider' => 'pollinations', 'model' => 'sana', 'type' => 'image', 'daily_limit' => 10]);

        return [$image, $user->chats()->create(['title' => 'Новый чат', 'ai_model_id' => $image->id])];
    }

    private function imageRequest(): Request
    {
        return Http::recorded(fn (Request $r) => str_contains($r->url(), 'image.pollinations.ai'))->last()[0];
    }

    public function test_russian_request_is_rewritten_into_english_prompt(): void
    {
        Sanctum::actingAs($user = User::factory()->create(), ['user']);
        [, $chat] = $this->chat($user);
        $this->fakeProviders('"A cute fluffy cat sitting on a windowsill, soft daylight"');

        $this->postJson("/api/chats/{$chat->id}/messages", ['content' => 'надо изоброжение кошки'])->assertCreated();

        $url = urldecode($this->imageRequest()->url());
        $this->assertStringContainsString('/prompt/A cute fluffy cat sitting on a windowsill, soft daylight?', $url);
        // The chat still shows what the user wrote.
        $this->assertDatabaseHas('messages', ['role' => 'assistant', 'content' => 'надо изоброжение кошки']);
    }

    public function test_follow_up_request_is_combined_with_the_previous_picture(): void
    {
        Sanctum::actingAs($user = User::factory()->create(), ['user']);
        [$image, $chat] = $this->chat($user);
        $chat->messages()->create(['ai_model_id' => $image->id, 'role' => 'assistant', 'content' => 'надо изоброжение кошки', 'image_path' => 'images/old.jpg']);
        $this->fakeProviders('A ginger cat with green eyes');

        $this->postJson("/api/chats/{$chat->id}/messages", ['content' => 'а теперь сделай её рыжей'])->assertCreated();

        $translation = Http::recorded(fn (Request $r) => str_contains($r->url(), 'text.pollinations.ai'))->first()[0];
        $this->assertStringContainsString('надо изоброжение кошки', $translation['messages'][1]['content']);
        $this->assertStringContainsString('A ginger cat with green eyes', urldecode($this->imageRequest()->url()));
    }

    public function test_english_prompt_goes_straight_to_the_generator(): void
    {
        Sanctum::actingAs($user = User::factory()->create(), ['user']);
        [, $chat] = $this->chat($user);
        $this->fakeProviders('should not be used');

        $this->postJson("/api/chats/{$chat->id}/messages", ['content' => 'a red fox in the snow'])->assertCreated();

        Http::assertNotSent(fn (Request $r) => str_contains($r->url(), 'text.pollinations.ai'));
        $this->assertStringContainsString('/prompt/a red fox in the snow?', urldecode($this->imageRequest()->url()));
    }

    public function test_useless_translation_falls_back_to_the_original_text(): void
    {
        Sanctum::actingAs($user = User::factory()->create(), ['user']);
        [, $chat] = $this->chat($user);
        $this->fakeProviders('User Safety: safe');

        $this->postJson("/api/chats/{$chat->id}/messages", ['content' => 'нарисуй кошку'])->assertCreated();

        $this->assertStringContainsString('/prompt/нарисуй кошку?', urldecode($this->imageRequest()->url()));
    }
}
