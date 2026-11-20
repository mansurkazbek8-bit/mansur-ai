<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Модель Eloquent «Покупка агента» (таблица agent_purchases).
 * Каждая строка — один купленный агент команды: слот, сумма, способ оплаты, статус.
 */
class AgentPurchase extends Model
{
    public const PAID = 'paid'; // статус «оплачено»

    // $fillable — поля, которые можно заполнять массивом (защита от подстановки лишних полей).
    protected $fillable = ['user_id', 'slot', 'amount', 'currency', 'provider', 'status', 'paid_at'];

    protected function casts(): array
    {
        return ['paid_at' => 'datetime'];
    }

    /** Локальный scope: AgentPurchase::paid() — только оплаченные покупки. */
    public function scopePaid(Builder $query): void
    {
        $query->where('status', self::PAID);
    }

    /** Связь «принадлежит» (BelongsTo): покупатель. */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
