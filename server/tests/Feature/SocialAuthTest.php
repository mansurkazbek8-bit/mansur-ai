<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\SocialAuth;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SocialAuthTest extends TestCase
{
    use RefreshDatabase;

    private function enableGithub(): void
    {
        SocialAuth::setCredentials('github', ['client_id' => 'gh-id', 'client_secret' => 'gh-secret']);
    }

    private function fakeGithub(string $email = 'new@example.com', int $id = 42): void
    {
        Http::fake([
            'github.com/login/oauth/access_token' => Http::response(['access_token' => 'tok']),
            'api.github.com/user/emails' => Http::response([['email' => $email, 'verified' => true, 'primary' => true]]),
            'api.github.com/user' => Http::response(['id' => $id, 'login' => 'octo', 'name' => 'Octo Cat']),
        ]);
    }

    /** Runs the redirect → callback steps and returns the URL the browser lands on. */
    private function signIn(string $query = 'client=web'): string
    {
        $location = $this->get("/auth/github?{$query}")->assertRedirect()->headers->get('Location');
        parse_str(parse_url($location, PHP_URL_QUERY), $params);

        return $this->get('/auth/github/callback?code=abc&state='.$params['state'])->headers->get('Location');
    }

    public function test_only_configured_providers_are_listed(): void
    {
        $this->getJson('/api/oauth/providers')->assertExactJson(['data' => []]);
        $this->enableGithub();
        $this->getJson('/api/oauth/providers')->assertJsonPath('data.0.name', 'github')->assertJsonCount(1, 'data');
    }

    public function test_site_sign_in_creates_user_and_issues_token(): void
    {
        $this->enableGithub();
        $this->fakeGithub();

        $landing = $this->signIn();
        $this->assertStringStartsWith(url('/').'?oauth_code=', $landing);
        parse_str(parse_url($landing, PHP_URL_QUERY), $params);

        $res = $this->postJson('/api/oauth/exchange', ['code' => $params['oauth_code']])->assertOk();
        $this->assertSame('new@example.com', $res->json('user.email'));
        $this->assertSame('Octo Cat', $res->json('user.name'));
        $user = User::where('email', 'new@example.com')->first();
        $this->assertNull($user->password);
        $this->assertSame(['user'], $user->tokens()->first()->abilities);

        // The code works only once.
        $this->postJson('/api/oauth/exchange', ['code' => $params['oauth_code']])->assertStatus(422);
    }

    public function test_existing_account_is_linked_by_verified_email(): void
    {
        $this->enableGithub();
        $existing = User::factory()->create(['email' => 'me@example.com']);
        $this->fakeGithub('Me@Example.com');

        $this->signIn();

        $this->assertSame(1, User::count());
        $this->assertDatabaseHas('social_accounts', ['user_id' => $existing->id, 'provider' => 'github', 'provider_id' => '42']);
    }

    public function test_desktop_app_gets_code_on_local_port_and_agent_ability(): void
    {
        $this->enableGithub();
        $this->fakeGithub();

        $landing = $this->signIn('client=desktop&port=51234');
        $this->assertStringStartsWith('http://127.0.0.1:51234/?code=', $landing);
        parse_str(parse_url($landing, PHP_URL_QUERY), $params);

        $this->postJson('/api/oauth/exchange', ['code' => $params['code']])->assertOk();
        $this->assertSame(['user', 'agent'], User::first()->tokens()->first()->abilities);
    }

    public function test_unknown_state_and_blocked_users_are_rejected(): void
    {
        $this->enableGithub();
        $this->get('/auth/github/callback?code=abc&state=forged')->assertRedirect('/?oauth_error='.urlencode('Ссылка входа устарела. Попробуйте ещё раз.'));

        User::factory()->create(['email' => 'new@example.com', 'is_blocked' => true]);
        $this->fakeGithub();
        $this->assertStringContainsString('oauth_error=', $this->signIn());
    }

    public function test_social_user_sets_first_password_without_old_one(): void
    {
        $user = User::factory()->create(['password' => null]);
        Sanctum::actingAs($user, ['user']);

        $this->patchJson('/api/me', ['password' => 'newpassword1'])->assertOk()->assertJsonPath('data.has_password', true);
        $this->postJson('/api/login', ['email' => $user->email, 'password' => 'newpassword1'])->assertOk();
    }

    public function test_admin_saves_credentials_without_exposing_secrets(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']), ['user']);

        $this->putJson('/api/admin/social/google', ['client_id' => 'gid', 'client_secret' => 'top-secret'])
            ->assertOk()->assertJsonPath('configured', true);
        $res = $this->getJson('/api/admin/social')->assertOk();
        $this->assertStringNotContainsString('top-secret', $res->getContent());

        // An empty secret keeps the saved one.
        $this->putJson('/api/admin/social/google', ['client_id' => 'gid2', 'client_secret' => ''])->assertJsonPath('configured', true);
        $this->assertSame('top-secret', SocialAuth::credentials('google')['client_secret']);
    }
}
