<?php

namespace Tests\Feature;

use App\Models\User;
use App\Notifications\ResetPasswordNotification;
use App\Services\MailSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PasswordResetTest extends TestCase
{
    use RefreshDatabase;

    private function configureMail(): void
    {
        MailSettings::save(['host' => 'smtp.example.com', 'port' => 587, 'username' => 'u', 'password' => 'p', 'from_address' => 'noreply@example.com', 'from_name' => 'Mansur AI']);
    }

    public function test_forgot_password_sends_a_link_and_reset_signs_in(): void
    {
        $this->configureMail();
        Notification::fake();
        $user = User::factory()->create(['email' => 'anna@example.com', 'password' => 'old-password']);
        $user->createToken('Сайт', ['user']);

        $this->postJson('/api/forgot-password', ['email' => 'ANNA@example.com'])->assertOk();

        $token = null;
        Notification::assertSentTo($user, ResetPasswordNotification::class, function ($n) use (&$token, $user) {
            $token = $n->token;

            return str_contains($n->toMail($user)->actionUrl, '/#/reset?token=');
        });

        $this->postJson('/api/reset-password', ['email' => 'anna@example.com', 'token' => $token, 'password' => 'new-password1', 'password_confirmation' => 'new-password1'])
            ->assertOk()->assertJsonStructure(['token', 'user']);

        $this->assertTrue(Hash::check('new-password1', $user->fresh()->password));
        // Old sessions are gone; only the fresh token from the reset remains.
        $this->assertSame(1, $user->tokens()->count());

        // The link works once.
        $this->postJson('/api/reset-password', ['email' => 'anna@example.com', 'token' => $token, 'password' => 'another-pass1', 'password_confirmation' => 'another-pass1'])
            ->assertStatus(422);
    }

    public function test_unknown_email_gets_the_same_answer_and_no_letter(): void
    {
        $this->configureMail();
        Notification::fake();

        $this->postJson('/api/forgot-password', ['email' => 'nobody@example.com'])
            ->assertOk()->assertJsonPath('message', fn ($m) => str_contains($m, 'Если аккаунт'));
        Notification::assertNothingSent();
    }

    public function test_without_mail_settings_the_form_explains_it(): void
    {
        config(['mail.default' => 'log']);
        $this->postJson('/api/forgot-password', ['email' => 'a@example.com'])->assertStatus(503);
    }

    public function test_wrong_token_is_rejected(): void
    {
        User::factory()->create(['email' => 'b@example.com']);
        $this->postJson('/api/reset-password', ['email' => 'b@example.com', 'token' => 'fake', 'password' => 'new-password1', 'password_confirmation' => 'new-password1'])
            ->assertStatus(422);
    }

    public function test_admin_saves_mail_settings_without_exposing_the_password(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']), ['user']);

        $this->putJson('/api/admin/mail', ['host' => 'smtp.gmail.com', 'port' => 587, 'username' => 'me@gmail.com', 'password' => 'abcd efgh ijkl mnop', 'from_address' => 'me@gmail.com'])
            ->assertOk()->assertJsonPath('configured', true)->assertJsonPath('password_filled', true)->assertJsonMissingPath('password');

        $this->assertSame('abcdefghijklmnop', MailSettings::stored()['password']); // spaces from Google's app password removed

        // Typical mistakes are explained instead of being saved.
        $this->putJson('/api/admin/mail', ['host' => 'smtp.gmail.com', 'port' => 587, 'username' => 'mansur.ai', 'password' => 'abcdefghijklmnop', 'from_address' => 'me@gmail.com'])
            ->assertStatus(422)->assertJsonValidationErrors('username');
        $this->putJson('/api/admin/mail', ['host' => 'smtp.gmail.com', 'port' => 587, 'username' => 'me@gmail.com', 'password' => 'MyGmailPass123', 'from_address' => 'me@gmail.com'])
            ->assertStatus(422)->assertJsonValidationErrors('password');

        // Empty password keeps the saved one.
        $this->putJson('/api/admin/mail', ['host' => 'smtp.gmail.com', 'port' => 465, 'username' => 'me@gmail.com', 'password' => '', 'from_address' => 'me@gmail.com'])->assertOk();
        $this->assertSame('abcdefghijklmnop', MailSettings::stored()['password']);
    }
}
