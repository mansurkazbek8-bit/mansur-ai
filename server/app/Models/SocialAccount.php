<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Модель «Привязанный аккаунт соцсети» (таблица social_accounts): Google/GitHub/Apple id пользователя. */
class SocialAccount extends Model
{
    protected $fillable = ['user_id', 'provider', 'provider_id'];

    /** Связь BelongsTo: пользователь Mansur AI. */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
