<?php

namespace Tests\Feature;

use App\Models\AgentTask;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Key scenario 2: agent tasks and their status machine. */
class AgentTaskScenarioTest extends TestCase
{
    use RefreshDatabase;

    public function test_full_lifecycle_with_log(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user, ['user', 'agent']);

        $id = $this->postJson('/api/agent-tasks', ['prompt' => 'Создай сайт'])->assertCreated()->json('data.id');

        $this->postJson("/api/agent/tasks/{$id}/logs", ['entries' => [['type' => 'info', 'text' => 'x']]])->assertStatus(409);
        $this->postJson("/api/agent/tasks/{$id}/start")->assertOk()->assertJsonPath('data.status', 'running');
        $this->postJson("/api/agent/tasks/{$id}/logs", ['entries' => [['type' => 'tool', 'text' => 'write_file index.html']]])->assertOk();
        $this->postJson("/api/agent/tasks/{$id}/complete", ['result' => 'Готово'])->assertOk()->assertJsonPath('data.status', 'completed');

        $task = AgentTask::find($id);
        $this->assertCount(1, $task->log);
        $this->assertNotNull($task->finished_at);

        // completed → cancelled is not allowed
        $this->postJson("/api/agent-tasks/{$id}/cancel")->assertStatus(409);
    }

    /** Постмортем: задача, по которой приложение молчит больше 3 часов, не должна висеть «в работе» вечно. */
    public function test_silent_running_task_is_failed_automatically(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user, ['user', 'agent']);
        $id = $this->postJson('/api/agent-tasks', ['prompt' => 'Создай сайт'])->json('data.id');
        $this->postJson("/api/agent/tasks/{$id}/start")->assertOk();

        $this->travel(4)->hours(); // компьютер выключили посреди задачи
        $this->getJson('/api/agent-tasks')->assertOk()->assertJsonPath('data.0.status', 'failed');
        $this->assertStringContainsString('перестало отвечать', AgentTask::find($id)->result);
    }

    public function test_unfinished_tasks_limit(): void
    {
        Sanctum::actingAs(User::factory()->create(), ['user']);

        foreach (range(1, 3) as $i) {
            $this->postJson('/api/agent-tasks', ['prompt' => "Задача {$i}"])->assertCreated();
        }
        $this->postJson('/api/agent-tasks', ['prompt' => 'Лишняя'])->assertStatus(422);
    }

    public function test_agent_endpoints_need_agent_ability(): void
    {
        Sanctum::actingAs(User::factory()->create(), ['user']);

        $this->getJson('/api/agent/tasks')->assertForbidden();
    }

    public function test_admin_routes_need_admin_role(): void
    {
        Sanctum::actingAs(User::factory()->create(), ['user']);
        $this->getJson('/api/admin/users')->assertForbidden();

        $admin = User::factory()->create();
        $admin->role = User::ROLE_ADMIN;
        $admin->save();
        Sanctum::actingAs($admin, ['user']);
        $this->getJson('/api/admin/users')->assertOk();
    }

    public function test_register_and_login(): void
    {
        $this->postJson('/api/register', ['name' => 'Мансур', 'email' => 'm@mail.ru', 'password' => 'short'])->assertStatus(422);
        $this->postJson('/api/register', ['name' => 'Мансур', 'email' => 'm@mail.ru', 'password' => 'password1'])
            ->assertCreated()->assertJsonStructure(['user' => ['id', 'email'], 'token']);
        $this->postJson('/api/login', ['email' => 'm@mail.ru', 'password' => 'wrong'])->assertStatus(422);
        $this->postJson('/api/login', ['email' => 'm@mail.ru', 'password' => 'password1'])->assertOk();
        $this->assertNotSame('password1', User::first()->password);
    }
}
