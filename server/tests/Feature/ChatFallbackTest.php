<?php

namespace Tests\Feature;

use App\Models\AiModel;
use App\Models\User;
use App\Services\AiGateway;
use App\Services\Providers;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ChatFallbackTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['ai.providers.openrouter.env_key' => 'TEST_OPENROUTER_KEY']);
        putenv('TEST_OPENROUTER_KEY=test-key');
        Providers::flush();
    }

    protected function tearDown(): void
    {
        putenv('TEST_OPENROUTER_KEY');
        parent::tearDown();
    }

    public function test_busy_model_hands_the_answer_to_another_one_in_the_same_role(): void
    {
        Sanctum::actingAs($user = User::factory()->create(), ['user']);
        $coder = AiModel::create(['slug' => 'mansur-coder', 'name' => 'Mansur Coder', 'provider' => 'pollinations', 'model' => 'openai-fast', 'type' => 'text', 'daily_limit' => 10, 'system_prompt' => 'Ты — Mansur Coder']);
        AiModel::create(['slug' => 'gemma', 'name' => 'Gemma', 'provider' => 'openrouter', 'model' => 'google/gemma:free', 'type' => 'text', 'daily_limit' => 10, 'sort' => 5]);
        $chat = $user->chats()->create(['title' => 'Новый чат', 'ai_model_id' => $coder->id]);
        Http::fake([
            'text.pollinations.ai/*' => Http::response(['error' => 'busy'], 503),
            'openrouter.ai/*' => Http::response(['choices' => [['message' => ['role' => 'assistant', 'content' => 'Вот рабочий код']]]]),
        ]);

        $this->postJson("/api/chats/{$chat->id}/messages", ['content' => 'Напиши функцию сортировки'])
            ->assertCreated()
            ->assertJsonPath('assistant_message.content', 'Вот рабочий код')
            ->assertJsonPath('assistant_message.model_name', 'Gemma')
            ->assertJsonPath('remaining', 9); // the chosen model's limit is the one charged

        // The substitute got the chosen model's role.
        Http::assertSent(fn (Request $r) => str_contains($r->url(), 'openrouter.ai') && str_contains($r['messages'][0]['content'], 'Ты — Mansur Coder'));
        $this->assertSame($coder->id, $chat->fresh()->ai_model_id);
    }

    public function test_all_models_failing_still_returns_502_without_charging(): void
    {
        Sanctum::actingAs($user = User::factory()->create(), ['user']);
        $chatModel = AiModel::create(['slug' => 'chat', 'name' => 'Chat', 'provider' => 'pollinations', 'model' => 'openai-fast', 'type' => 'text', 'daily_limit' => 10]);
        AiModel::create(['slug' => 'gemma', 'name' => 'Gemma', 'provider' => 'openrouter', 'model' => 'google/gemma:free', 'type' => 'text', 'daily_limit' => 10]);
        $chat = $user->chats()->create(['title' => 'Новый чат', 'ai_model_id' => $chatModel->id]);
        Http::fake(['*' => Http::response(['error' => 'down'], 500)]);

        $this->postJson("/api/chats/{$chat->id}/messages", ['content' => 'Привет'])->assertStatus(502);
        $this->assertDatabaseMissing('usage_counters', ['user_id' => $user->id, 'requests_count' => 1]);
    }

    /** Баг из постмортема: «Retry after 2s» нужно ждать 3 с, а не полный период «every 45 seconds». */
    public function test_free_limit_waits_the_remaining_seconds_not_the_whole_period(): void
    {
        $model = AiModel::create(['slug' => 'chat', 'name' => 'Chat', 'provider' => 'pollinations', 'model' => 'openai-fast', 'type' => 'text', 'daily_limit' => 10]);
        Http::fake(['text.pollinations.ai/*' => Http::sequence()
            ->push(['status' => 402, 'error' => ['code' => 'FREE_LIMIT', 'message' => 'Free limit reached: 1 reply every 45 seconds per IP. Retry after 2s']], 402, ['Retry-After' => '2'])
            ->push(['choices' => [['message' => ['role' => 'assistant', 'content' => 'Готово']]]]),
        ]);

        // maxWait 10 с: старый код считал 46 с ожидания, превышал лимит и сразу выдавал «перегружена».
        $reply = app(AiGateway::class)->chat($model, [['role' => 'user', 'content' => 'Привет']], maxWait: 10);

        $this->assertSame('Готово', $reply['content']);
        Http::assertSentCount(2);
    }

    public function test_daily_quota_is_remembered_and_the_provider_skipped(): void
    {
        Sanctum::actingAs($user = User::factory()->create(), ['user']);
        $nemotron = AiModel::create(['slug' => 'nemotron', 'name' => 'Nemotron', 'provider' => 'openrouter', 'model' => 'nvidia/x:free', 'type' => 'text', 'daily_limit' => 10]);
        AiModel::create(['slug' => 'chat', 'name' => 'Chat', 'provider' => 'pollinations', 'model' => 'openai-fast', 'type' => 'text', 'daily_limit' => 10]);
        $chat = $user->chats()->create(['title' => 'Новый чат', 'ai_model_id' => $nemotron->id]);
        Http::fake([
            'openrouter.ai/*' => Http::response(['error' => ['message' => 'Rate limit exceeded: free-models-per-day', 'code' => 429,
                'metadata' => ['headers' => ['X-RateLimit-Reset' => (string) ((time() + 3600) * 1000)], 'limit_source' => 'openrouter_free_tier_daily']]], 429),
            'text.pollinations.ai/*' => Http::response(['choices' => [['message' => ['role' => 'assistant', 'content' => 'Ответ']]]]),
        ]);

        $this->postJson("/api/chats/{$chat->id}/messages", ['content' => 'Привет'])->assertCreated()->assertJsonPath('assistant_message.model_name', 'Chat');
        $this->assertNotNull(Providers::exhaustedUntil('openrouter'));

        // The next message doesn't even try OpenRouter.
        $this->postJson("/api/chats/{$chat->id}/messages", ['content' => 'Ещё раз'])->assertCreated();
        Http::assertSentCount(3);
    }
}
