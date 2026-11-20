<?php

namespace App\Models;

use App\Notifications\ResetPasswordNotification;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

/**
 * Модель «Пользователь» (таблица users). Роли: user и admin.
 * HasApiTokens — токены Sanctum для входа в API; Notifiable — отправка писем (сброс пароля).
 * #[Fillable] — какие поля можно заполнять массивом; #[Hidden] — какие поля НИКОГДА не попадают в JSON.
 */
#[Fillable(['name', 'email', 'password'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    public const ROLE_USER = 'user';   // обычный пользователь

    public const ROLE_ADMIN = 'admin'; // администратор

    protected $attributes = ['role' => self::ROLE_USER, 'is_blocked' => false];

    /**
     * Приведение типов: 'password' => 'hashed' — пароль автоматически хешируется bcrypt при сохранении,
     * в базе никогда не хранится открытый пароль.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_blocked' => 'boolean',
            'appearance' => 'array',
        ];
    }

    /** Письмо «Сброс пароля» на русском со ссылкой на форму сайта (вызывает Password::broker). */
    public function sendPasswordResetNotification($token): void
    {
        $this->notify(new ResetPasswordNotification($token));
    }

    /** Является ли пользователь администратором. */
    public function isAdmin(): bool
    {
        return $this->role === self::ROLE_ADMIN;
    }

    /** Связь HasMany: чаты пользователя. */
    public function chats(): HasMany
    {
        return $this->hasMany(Chat::class);
    }

    /** Связь HasMany: задачи для ИИ-агента. */
    public function agentTasks(): HasMany
    {
        return $this->hasMany(AgentTask::class);
    }

    /** Связь HasMany: купленные агенты. */
    public function agentPurchases(): HasMany
    {
        return $this->hasMany(AgentPurchase::class);
    }

    /** Связь HasMany: привязанные Google/GitHub/Apple. */
    public function socialAccounts(): HasMany
    {
        return $this->hasMany(SocialAccount::class);
    }

    /** Связь HasMany: счётчики дневных лимитов. */
    public function usageCounters(): HasMany
    {
        return $this->hasMany(UsageCounter::class);
    }
}
