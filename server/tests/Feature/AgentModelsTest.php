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

class AgentModelsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Providers::flush();
    }

    private function agentModel(string $slug, string $provider, string $model, int $sort): AiModel
    {
        return AiModel::create(['slug' => $slug, 'name' => $slug, 'provider' => $provider, 'model' => $model, 'type' => 'agent', 'daily_limit' => 100, 'sort' => $sort]);
    }

    public function test_agent_draws_pictures_with_translated_prompt(): void
    {
        Storage::fake('public');
        Sanctum::actingAs(User::factory()->create(), ['user', 'agent']);
        AiModel::create(['slug' => 'chat', 'name' => 'Chat', 'provider' => 'pollinations', 'model' => 'openai-fast', 'type' => 'text', 'daily_limit' => 10]);
        AiModel::create(['slug' => 'img', 'name' => 'Image', 'provider' => 'pollinations', 'model' => 'sana', 'type' => 'image', 'daily_limit' => 10]);
        Http::fake([
            'text.pollinations.ai/*' => Http::response(['choices' => [['message' => ['role' => 'assistant', 'content' => 'Cozy coffee shop interior, warm light']]]]),
            'image.pollinations.ai/*' => Http::response('jpeg-bytes', 200, ['Content-Type' => 'image/jpeg']),
        ]);

        $this->postJson('/api/agent/image', ['prompt' => 'уютная кофейня'])->assertCreated()->assertJsonStructure(['url']);
        Http::assertSent(fn (Request $r) => str_contains(urldecode($r->url()), '/prompt/Cozy coffee shop interior, warm light?'));
    }

    public function test_busy_strong_model_hands_the_step_to_the_next_one(): void
    {
        config(['ai.providers.openrouter.env_key' => 'TEST_OPENROUTER_KEY']);
        putenv('TEST_OPENROUTER_KEY=test-key');
        Providers::flush();
        Sanctum::actingAs(User::factory()->create(), ['user', 'agent']);
        $this->agentModel('strong', 'openrouter', 'nvidia/strong:free', 30);
        $this->agentModel('fallback', 'pollinations', 'openai-fast', 40);
        Http::fake([
            'openrouter.ai/*' => Http::response(['error' => ['message' => 'busy']], 429),
            'text.pollinations.ai/*' => Http::response(['choices' => [['message' => ['role' => 'assistant', 'content' => 'План готов']]]]),
        ]);

        $this->postJson('/api/agent/step', ['messages' => [['role' => 'user', 'content' => 'Сделай сайт']], 'tools' => []])
            ->assertOk()->assertJsonPath('message.content', 'План готов');
        putenv('TEST_OPENROUTER_KEY');
    }

    public function test_cut_off_answer_is_reported_to_the_app(): void
    {
        Sanctum::actingAs(User::factory()->create(), ['user', 'agent']);
        $this->agentModel('agent', 'pollinations', 'openai-fast', 40);
        Http::fake(['text.pollinations.ai/*' => Http::response(['choices' => [['message' => ['role' => 'assistant', 'content' => '<!DOCTYPE html>...'], 'finish_reason' => 'length']]])]);

        $this->postJson('/api/agent/step', ['messages' => [['role' => 'user', 'content' => 'Сделай сайт']], 'tools' => []])
            ->assertOk()->assertJsonPath('finish_reason', 'length');
    }

    public function test_model_that_died_mid_answer_hands_over_to_the_next_one(): void
    {
        config(['ai.providers.openrouter.env_key' => 'TEST_OPENROUTER_KEY']);
        putenv('TEST_OPENROUTER_KEY=test-key');
        Providers::flush();
        Sanctum::actingAs(User::factory()->create(), ['user', 'agent']);
        $this->agentModel('strong', 'openrouter', 'nvidia/strong:free', 30);
        $this->agentModel('fallback', 'pollinations', 'openai-fast', 40);
        Http::fake([
            'openrouter.ai/*' => Http::response(['choices' => [['message' => ['role' => 'assistant', 'content' => ''], 'finish_reason' => 'error']]]),
            'text.pollinations.ai/*' => Http::response(['choices' => [['message' => ['role' => 'assistant', 'content' => '', 'tool_calls' => [['id' => 'c1', 'type' => 'function', 'function' => ['name' => 'write_file', 'arguments' => '{}']]]], 'finish_reason' => 'tool_calls']]]),
        ]);

        $this->postJson('/api/agent/step', ['messages' => [['role' => 'user', 'content' => 'Сделай сайт']], 'tools' => []])
            ->assertOk()->assertJsonPath('message.tool_calls.0.function.name', 'write_file');
        putenv('TEST_OPENROUTER_KEY');
    }
}
