<?php

namespace Tests\Feature;

use App\Models\AiModel;
use App\Models\Chat;
use App\Models\UsageCounter;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Key scenario 1: sending a message with a daily-limit check. */
class MessageScenarioTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private AiModel $model;

    private Chat $chat;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->model = AiModel::create([
            'slug' => 'test-chat', 'name' => 'Test Chat', 'provider' => 'pollinations',
            'model' => 'openai-fast', 'type' => 'text', 'daily_limit' => 2,
        ]);
        $this->chat = $this->user->chats()->create(['title' => 'Новый чат', 'ai_model_id' => $this->model->id]);
        Sanctum::actingAs($this->user, ['user']);
    }

    private function fakeAi(int $status = 200): void
    {
        Http::fake(['*' => Http::response($status === 200
            ? ['choices' => [['message' => ['role' => 'assistant', 'content' => 'Привет!']]], 'usage' => ['total_tokens' => 10]]
            : ['error' => 'down'], $status)]);
    }

    public function test_message_is_answered_and_limit_charged(): void
    {
        $this->fakeAi();

        $this->postJson("/api/chats/{$this->chat->id}/messages", ['content' => 'Как дела?'])
            ->assertCreated()
            ->assertJsonPath('assistant_message.content', 'Привет!')
            ->assertJsonPath('remaining', 1);

        $this->assertSame(1, UsageCounter::first()->requests_count);
        $this->assertSame('Как дела?', $this->chat->fresh()->title);
    }

    public function test_limit_exceeded_returns_429(): void
    {
        $this->fakeAi();
        UsageCounter::create(['user_id' => $this->user->id, 'ai_model_id' => $this->model->id, 'date' => today(), 'requests_count' => 2]);

        $this->postJson("/api/chats/{$this->chat->id}/messages", ['content' => 'Ещё вопрос'])->assertStatus(429);
        Http::assertNothingSent();
    }

    public function test_provider_failure_does_not_charge_limit(): void
    {
        $this->fakeAi(500);
        config(['ai.max_wait' => 0]);

        $this->postJson("/api/chats/{$this->chat->id}/messages", ['content' => 'Вопрос'])->assertStatus(502);

        $this->assertSame(0, (int) UsageCounter::sum('requests_count'));
        $this->assertDatabaseHas('messages', ['chat_id' => $this->chat->id, 'status' => 'failed']);
    }

    public function test_validation_and_inactive_model(): void
    {
        $this->postJson("/api/chats/{$this->chat->id}/messages", ['content' => ''])->assertStatus(422);

        $this->model->update(['is_active' => false]);
        $this->postJson("/api/chats/{$this->chat->id}/messages", ['content' => 'Привет'])
            ->assertStatus(422)->assertJsonPath('message', 'Модель недоступна');
    }

    public function test_foreign_chat_is_forbidden_and_guest_unauthorized(): void
    {
        $other = User::factory()->create();
        $foreign = $other->chats()->create(['title' => 'Чужой', 'ai_model_id' => $this->model->id]);

        $this->postJson("/api/chats/{$foreign->id}/messages", ['content' => 'Привет'])->assertForbidden();
        $this->getJson("/api/chats/{$foreign->id}")->assertForbidden();
    }

    public function test_blocked_user_is_rejected(): void
    {
        $this->user->forceFill(['is_blocked' => true])->save();

        $this->getJson('/api/chats')->assertForbidden();
    }

    public function test_search_finds_chat_by_message_text(): void
    {
        $this->chat->messages()->create(['role' => 'user', 'content' => 'Расскажи про Laravel', 'ai_model_id' => $this->model->id]);
        $this->user->chats()->create(['title' => 'Другой', 'ai_model_id' => $this->model->id]);

        $this->getJson('/api/chats?q=laravel')->assertOk()->assertJsonCount(1, 'data');
    }
}
