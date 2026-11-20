<?php

namespace Tests\Feature;

use App\Models\AgentTask;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AgentTeamTest extends TestCase
{
    use RefreshDatabase;

    private function task(User $user): AgentTask
    {
        return $user->agentTasks()->create(['title' => 'T', 'prompt' => 'Сделай сайт']);
    }

    public function test_one_agent_is_free_and_next_ones_cost_more(): void
    {
        Sanctum::actingAs($user = User::factory()->create(), ['user']);

        $this->getJson('/api/agents')->assertOk()
            ->assertJsonPath('owned', 1)->assertJsonPath('next_price', 3000)
            ->assertJsonPath('agents.0.slug', 'mansur')->assertJsonPath('agents.0.owned', true)
            ->assertJsonPath('agents.1.next', true)->assertJsonCount(5, 'agents');

        $this->postJson('/api/agents/buy')->assertCreated()->assertJsonPath('owned', 2)->assertJsonPath('next_price', 4000);
        $this->postJson('/api/agents/buy')->assertJsonPath('next_price', 5000);
        $this->postJson('/api/agents/buy')->assertJsonPath('next_price', 6000);
        $this->postJson('/api/agents/buy')->assertJsonPath('owned', 5)->assertJsonPath('next_price', null);
        $this->postJson('/api/agents/buy')->assertStatus(422);

        $this->assertSame(3000 + 4000 + 5000 + 6000, (int) $user->agentPurchases()->sum('amount'));
    }

    public function test_tasks_run_in_parallel_only_up_to_team_size(): void
    {
        Sanctum::actingAs($user = User::factory()->create(), ['user', 'agent']);
        [$a, $b, $c] = [$this->task($user), $this->task($user), $this->task($user)];

        $this->postJson("/api/agent/tasks/{$a->id}/start")->assertOk()->assertJsonPath('data.agent_slot', 1);
        // One free agent: the second task has to wait.
        $this->postJson("/api/agent/tasks/{$b->id}/start")->assertStatus(409);

        $this->postJson('/api/agents/buy')->assertCreated();
        $this->postJson("/api/agent/tasks/{$b->id}/start")->assertOk()->assertJsonPath('data.agent_slot', 2);
        $this->postJson("/api/agent/tasks/{$c->id}/start")->assertStatus(409);

        // When an agent finishes, its slot is free again.
        $this->postJson("/api/agent/tasks/{$a->id}/complete", ['result' => 'ok'])->assertOk();
        $this->postJson("/api/agent/tasks/{$c->id}/start")->assertOk()->assertJsonPath('data.agent_slot', 1);
        $this->getJson('/api/agents')->assertJsonPath('agents.0.task.id', $c->id)->assertJsonPath('agents.1.task.id', $b->id);
    }

    public function test_agent_that_is_not_owned_or_busy_cannot_take_a_task(): void
    {
        Sanctum::actingAs($user = User::factory()->create(), ['user', 'agent']);
        [$a, $b] = [$this->task($user), $this->task($user)];

        $this->postJson("/api/agent/tasks/{$a->id}/start", ['slot' => 3])->assertForbidden();
        $this->postJson("/api/agent/tasks/{$a->id}/start", ['slot' => 1])->assertOk();
        $this->postJson('/api/agents/buy');
        $this->postJson("/api/agent/tasks/{$b->id}/start", ['slot' => 1])->assertStatus(409);
        $this->postJson("/api/agent/tasks/{$b->id}/start", ['slot' => 2])->assertOk();
    }

    public function test_admin_gifts_agents_and_sees_revenue(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user, ['user']);
        $this->postJson('/api/agents/buy');

        Sanctum::actingAs(User::factory()->create(['role' => 'admin']), ['user']);
        $this->putJson("/api/admin/users/{$user->id}/agents", ['count' => 4])->assertOk()->assertJsonPath('data.agents', 4);
        $this->getJson('/api/admin/stats')->assertJsonPath('totals.agents_sold', 1)->assertJsonPath('totals.agents_revenue', 3000);

        $this->putJson("/api/admin/users/{$user->id}/agents", ['count' => 1])->assertJsonPath('data.agents', 1);
        $this->putJson("/api/admin/users/{$user->id}/agents", ['count' => 9])->assertStatus(422);
    }

    public function test_guest_sees_the_roster_but_cannot_buy(): void
    {
        $this->getJson('/api/agents')->assertOk()->assertJsonPath('owned', 1)->assertJsonPath('agents.4.price', 6000);
        $this->postJson('/api/agents/buy')->assertUnauthorized();
    }

    public function test_buying_is_disabled_outside_demo_mode(): void
    {
        config(['agents.payment_mode' => 'off']);
        Sanctum::actingAs(User::factory()->create(), ['user']);

        $this->postJson('/api/agents/buy')->assertStatus(422);
    }
}
