<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AgentTeamModeTest extends TestCase
{
    use RefreshDatabase;

    public function test_together_mode_needs_two_agents(): void
    {
        Sanctum::actingAs(User::factory()->create(), ['user', 'agent']);

        $this->postJson('/api/agent-tasks', ['prompt' => 'Сделай интернет-магазин', 'mode' => 'team'])->assertStatus(422);
        $this->postJson('/api/agents/buy');
        $this->postJson('/api/agent-tasks', ['prompt' => 'Сделай интернет-магазин', 'mode' => 'team'])->assertCreated()->assertJsonPath('data.mode', 'team');
    }

    public function test_lead_splits_task_and_team_runs_parts_in_parallel(): void
    {
        Sanctum::actingAs($user = User::factory()->create(), ['user', 'agent']);
        $this->postJson('/api/agents/buy');
        $parent = $this->postJson('/api/agent-tasks', ['prompt' => 'Сделай сайт', 'mode' => 'team', 'workspace' => 'C:\\Shop'])->json('data.id');

        $this->postJson("/api/agent/tasks/{$parent}/start")->assertJsonPath('data.agent_slot', 1);
        $a = $this->postJson('/api/agent-tasks', ['parent_id' => $parent, 'title' => 'Страницы', 'prompt' => 'HTML страницы'])
            ->assertCreated()->assertJsonPath('data.workspace', 'C:\\Shop')->json('data.id');
        $b = $this->postJson('/api/agent-tasks', ['parent_id' => $parent, 'title' => 'Стили', 'prompt' => 'CSS'])->json('data.id');

        // Both agents are busy with the lead holding one: release it so both parts can run.
        $this->postJson("/api/agent/tasks/{$a}/start")->assertJsonPath('data.agent_slot', 2);
        $this->postJson("/api/agent/tasks/{$b}/start")->assertStatus(409);
        $this->postJson("/api/agent/tasks/{$parent}/slot", ['slot' => null])->assertJsonPath('data.agent_slot', null);
        $this->postJson("/api/agent/tasks/{$b}/start")->assertJsonPath('data.agent_slot', 1);

        $this->postJson("/api/agent/tasks/{$a}/complete", ['result' => 'ok']);
        $this->postJson("/api/agent/tasks/{$b}/complete", ['result' => 'ok']);
        // The lead takes an agent back for the final check.
        $this->postJson("/api/agent/tasks/{$parent}/slot", ['slot' => 2])->assertJsonPath('data.agent_slot', 2);

        $list = $this->getJson('/api/agent-tasks')->assertOk();
        $this->assertCount(1, $list->json('data'));
        $this->assertSame(['completed', 'completed'], array_column($list->json('data.0.subtasks'), 'status'));
    }

    public function test_subtasks_only_for_running_team_task_and_cancel_cascades(): void
    {
        Sanctum::actingAs(User::factory()->create(), ['user', 'agent']);
        $this->postJson('/api/agents/buy');
        $solo = $this->postJson('/api/agent-tasks', ['prompt' => 'Один'])->json('data.id');
        $this->postJson('/api/agent-tasks', ['parent_id' => $solo, 'prompt' => 'Часть'])->assertStatus(409);

        $team = $this->postJson('/api/agent-tasks', ['prompt' => 'Большая', 'mode' => 'team'])->json('data.id');
        $this->postJson("/api/agent/tasks/{$team}/start");
        $part = $this->postJson('/api/agent-tasks', ['parent_id' => $team, 'prompt' => 'Часть'])->json('data.id');
        $this->postJson("/api/agent-tasks/{$team}/cancel")->assertOk();
        $this->getJson("/api/agent-tasks/{$part}")->assertJsonPath('data.status', 'cancelled');
    }

    public function test_foreign_parent_is_rejected(): void
    {
        $other = User::factory()->create();
        $task = $other->agentTasks()->create(['title' => 'x', 'prompt' => 'x', 'mode' => 'team', 'status' => 'running']);
        Sanctum::actingAs(User::factory()->create(), ['user']);

        $this->postJson('/api/agent-tasks', ['parent_id' => $task->id, 'prompt' => 'Часть'])->assertNotFound();
    }
}
