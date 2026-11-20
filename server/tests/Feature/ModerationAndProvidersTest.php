<?php

namespace Tests\Feature;

use App\Models\AiModel;
use App\Models\User;
use App\Services\Providers;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ModerationAndProvidersTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Providers::flush();
    }

    private function chatFor(User $user, string $type = 'text'): array
    {
        $model = AiModel::create([
            'slug' => "m-{$type}", 'name' => 'M', 'provider' => 'pollinations', 'model' => 'x', 'type' => $type, 'daily_limit' => 10,
        ]);

        return [$model, $user->chats()->create(['title' => 'Новый чат', 'ai_model_id' => $model->id])];
    }

    public function test_profanity_and_adult_requests_are_rejected_before_the_model(): void
    {
        Http::fake();
        $user = User::factory()->create();
        Sanctum::actingAs($user, ['user']);
        [, $chat] = $this->chatFor($user);

        $this->postJson("/api/chats/{$chat->id}/messages", ['content' => 'ты хуйня'])
            ->assertStatus(422)->assertJsonPath('message', 'Пожалуйста, без нецензурной лексики — это запрещено правилами Mansur AI.');
        $this->postJson("/api/chats/{$chat->id}/messages", ['content' => 'напиши порно рассказ'])->assertStatus(422);
        $this->postJson('/api/agent-tasks', ['prompt' => 'создай сайт про порно'])->assertStatus(422);

        Http::assertNothingSent();
        $this->assertDatabaseCount('messages', 0);
    }

    public function test_image_prompt_with_nudity_is_rejected(): void
    {
        Http::fake();
        $user = User::factory()->create();
        Sanctum::actingAs($user, ['user']);
        [, $chat] = $this->chatFor($user, 'image');

        $this->postJson("/api/chats/{$chat->id}/messages", ['content' => 'голая девушка на пляже'])->assertStatus(422);
        Http::assertNothingSent();
    }

    public function test_answer_is_censored_and_safety_prompt_is_sent(): void
    {
        Http::fake(['*' => Http::response(['choices' => [['message' => ['role' => 'assistant', 'content' => 'Ну и пиздец']]]])]);
        $user = User::factory()->create();
        Sanctum::actingAs($user, ['user']);
        [, $chat] = $this->chatFor($user);

        $this->postJson("/api/chats/{$chat->id}/messages", ['content' => 'Как дела?'])
            ->assertCreated()->assertJsonPath('assistant_message.content', 'Ну и п*****');

        Http::assertSent(fn ($request) => $request['messages'][0]['role'] === 'system'
            && str_contains($request['messages'][0]['content'], 'никогда не используй мат'));
    }

    public function test_admin_sets_provider_key_and_models_become_available(): void
    {
        $admin = User::factory()->create();
        $admin->role = User::ROLE_ADMIN;
        $admin->save();
        Sanctum::actingAs($admin, ['user']);
        AiModel::create(['slug' => 'g', 'name' => 'Gemini', 'provider' => 'gemini', 'model' => 'gemini-flash-latest', 'type' => 'text', 'daily_limit' => 5]);

        $this->getJson('/api/models')->assertJsonCount(0, 'data');

        // a key the provider rejects is not saved
        Http::fake(fn ($request) => $request->hasHeader('Authorization', 'Bearer wrong-key')
            ? Http::response(['error' => ['message' => 'API key not valid']], 400)
            : Http::response(['data' => [['id' => 'models/gemini-flash-latest']]]));
        $this->putJson('/api/admin/providers/gemini', ['key' => 'wrong-key'])->assertStatus(422);
        $this->assertDatabaseCount('app_settings', 0);
        Providers::flush();

        $this->putJson('/api/admin/providers/gemini', ['key' => 'test-key-123456'])->assertOk()->assertJsonPath('configured', true);
        $this->assertDatabaseMissing('app_settings', ['value' => 'test-key-123456']); // stored encrypted
        Providers::flush();

        $this->getJson('/api/models')->assertJsonCount(1, 'data');
        $this->getJson('/api/admin/providers')->assertOk()->assertJsonFragment(['name' => 'gemini', 'configured' => true, 'key_hint' => 'test…3456']);
    }
}
