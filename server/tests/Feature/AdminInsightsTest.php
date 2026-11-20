<?php

namespace Tests\Feature;

use App\Models\AgentPurchase;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\PersonalAccessToken;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminInsightsTest extends TestCase
{
    use RefreshDatabase;

    private function seen(User $user, array $abilities, int $minutesAgo): void
    {
        $token = $user->createToken('t', $abilities)->accessToken;
        PersonalAccessToken::whereKey($token->id)->update(['last_used_at' => now()->subMinutes($minutesAgo)]);
    }

    public function test_admin_sees_who_is_online_on_the_site_and_in_the_app(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $web = User::factory()->create(['name' => 'Сайт Онлайн']);
        $app = User::factory()->create(['name' => 'Приложение Онлайн']);
        $both = User::factory()->create();
        $old = User::factory()->create();
        $this->seen($web, ['user'], 1);
        $this->seen($app, ['user', 'agent'], 0);
        $this->seen($both, ['user'], 2);
        $this->seen($both, ['user', 'agent'], 1);
        $this->seen($old, ['user'], 30);
        Sanctum::actingAs($admin, ['user']);

        $res = $this->getJson('/api/admin/stats')->assertOk();
        $res->assertJsonPath('online.total', 3)->assertJsonPath('online.site', 2)->assertJsonPath('online.app', 2)
            ->assertJsonPath('totals.app_users', 2);
        $this->assertCount(3, $res->json('online_users'));

        $this->getJson('/api/admin/users?online=1')->assertOk()->assertJsonCount(3, 'data');
        $u = collect($this->getJson('/api/admin/users')->json('data'))->firstWhere('id', $app->id);
        $this->assertTrue($u['online']);
        $this->assertTrue($u['uses_app']);
    }

    public function test_admin_sees_who_bought_which_agent(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $buyer = User::factory()->create(['name' => 'Покупатель', 'email' => 'buyer@example.com']);
        AgentPurchase::create(['user_id' => $buyer->id, 'slot' => 2, 'amount' => 3000, 'currency' => 'KZT', 'provider' => 'demo', 'status' => 'paid', 'paid_at' => now()]);
        AgentPurchase::create(['user_id' => $buyer->id, 'slot' => 3, 'amount' => 4000, 'currency' => 'KZT', 'provider' => 'demo', 'status' => 'paid', 'paid_at' => now()]);
        Sanctum::actingAs($admin, ['user']);

        $this->getJson('/api/admin/purchases')->assertOk()
            ->assertJsonPath('summary.revenue', 7000)->assertJsonPath('summary.buyers', 1)
            ->assertJsonPath('data.0.agent', 'Тулпар')->assertJsonPath('data.0.user.email', 'buyer@example.com');
        $this->getJson('/api/admin/purchases?q=nobody')->assertOk()->assertJsonCount(0, 'data');

        $u = collect($this->getJson('/api/admin/users?sort=spent')->json('data'))->first();
        $this->assertSame($buyer->id, $u['id']);
        $this->assertSame(7000, $u['spent']);
    }

    public function test_regular_user_cannot_see_admin_data(): void
    {
        Sanctum::actingAs(User::factory()->create(), ['user']);
        $this->getJson('/api/admin/purchases')->assertForbidden();
        $this->getJson('/api/admin/mail')->assertForbidden();
    }

    public function test_site_tab_heartbeat_keeps_the_user_online(): void
    {
        $user = User::factory()->create();
        $token = $user->createToken('Сайт', ['user'])->plainTextToken;
        $this->withToken($token)->postJson('/api/ping')->assertNoContent();
        $this->assertNotNull($user->tokens()->first()->last_used_at);
    }

    public function test_security_headers_and_privacy_page(): void
    {
        $this->get('/privacy')->assertOk()->assertSee('Политика конфиденциальности')
            ->assertHeader('X-Content-Type-Options', 'nosniff')->assertHeader('X-Frame-Options', 'SAMEORIGIN');
    }

    public function test_login_is_rate_limited(): void
    {
        for ($i = 0; $i < 10; $i++) {
            $this->postJson('/api/login', ['email' => 'x@example.com', 'password' => 'wrong'])->assertStatus(422);
        }
        $this->postJson('/api/login', ['email' => 'x@example.com', 'password' => 'wrong'])->assertStatus(429);
    }
}
