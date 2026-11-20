<?php

namespace App\Services;

use App\Models\AgentPurchase;
use App\Models\AgentTask;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Команда ИИ-агентов пользователя: агент №1 бесплатный, агенты 2–5 покупаются по одному.
 * Каждый агент выполняет одну задачу за раз, поэтому размер команды = сколько задач идут параллельно.
 * Список агентов (имена, цены, цвета) — в config/agents.php.
 */
class AgentTeam
{
    /** Каталог агентов из конфигурации: [номер слота => данные агента]. */
    public static function roster(): array
    {
        return config('agents.roster');
    }

    /** Максимальный размер команды (сейчас 5). */
    public static function max(): int
    {
        return count(self::roster());
    }

    /** Сколько агентов у пользователя: 1 бесплатный + оплаченные покупки. */
    public function size(User $user): int
    {
        return min(self::max(), 1 + $user->agentPurchases()->paid()->count());
    }

    /** Цена следующего агента или null, если команда уже полная. */
    public function nextPrice(User $user): ?int
    {
        return self::roster()[$this->size($user) + 1]['price'] ?? null;
    }

    /** Все агенты каталога: куплен ли, следующий ли к покупке и какой задачей сейчас занят. */
    public function overview(?User $user): array
    {
        $size = $user ? $this->size($user) : 1;
        $busy = $user ? $user->agentTasks()->where('status', AgentTask::RUNNING)->whereNotNull('agent_slot')
            ->get(['id', 'title', 'agent_slot', 'parent_id'])->keyBy('agent_slot') : collect();

        return [
            'owned' => $size,
            'max' => self::max(),
            'next_price' => self::roster()[$size + 1]['price'] ?? null,
            'currency' => config('agents.currency'),
            'payment_mode' => config('agents.payment_mode'),
            'agents' => collect(self::roster())->map(fn ($a, $slot) => [
                'slot' => $slot,
                ...$a,
                'image' => asset("img/agents/{$a['slug']}.png"),
                'owned' => $slot <= $size,
                'next' => $slot === $size + 1,
                'task' => isset($busy[$slot]) ? ['id' => $busy[$slot]->id, 'title' => $busy[$slot]->title, 'parent_id' => $busy[$slot]->parent_id] : null,
            ])->values()->all(),
        ];
    }

    /** Купить следующего агента. В демо-режиме (учебный проект) оплата подтверждается сразу, без платёжной системы. */
    public function buyNext(User $user): AgentPurchase
    {
        abort_if(config('agents.payment_mode') !== 'demo', 422, 'Покупка агентов пока недоступна');

        return DB::transaction(function () use ($user) {
            // Блокируем строку пользователя: двойной клик «Купить» не создаст две покупки одного слота.
            User::whereKey($user->id)->lockForUpdate()->first();
            $slot = $this->size($user) + 1;
            $agent = self::roster()[$slot] ?? abort(422, 'У вас уже вся команда агентов');

            return $user->agentPurchases()->updateOrCreate(['slot' => $slot], [
                'amount' => $agent['price'],
                'currency' => config('agents.currency'),
                'provider' => 'demo',
                'status' => AgentPurchase::PAID,
                'paid_at' => now(),
            ]);
        });
    }

    /** Администратор задаёт размер команды напрямую (подарок или возврат). */
    public function setSize(User $user, int $size): void
    {
        DB::transaction(function () use ($user, $size) {
            $user->agentPurchases()->where('slot', '>', $size)->delete();
            for ($slot = 2; $slot <= $size; $slot++) {
                $user->agentPurchases()->firstOrCreate(['slot' => $slot], [
                    'amount' => 0, 'currency' => config('agents.currency'),
                    'provider' => 'admin', 'status' => AgentPurchase::PAID, 'paid_at' => now(),
                ]);
            }
        });
    }

    /**
     * Выбрать агента для задачи: запрошенного, если он куплен и свободен, иначе первого свободного.
     * Не куплен — 403, занят — 409. Вызывается внутри транзакции (с блокировкой пользователя).
     */
    public function assignSlot(User $user, ?int $wanted): int
    {
        User::whereKey($user->id)->lockForUpdate()->first();
        $size = $this->size($user);
        $busy = $user->agentTasks()->where('status', AgentTask::RUNNING)->pluck('agent_slot')->filter()->all();

        if ($wanted !== null) {
            abort_if($wanted > $size, 403, 'Этот агент ещё не куплен');
            abort_if(in_array($wanted, $busy, true), 409, 'Этот агент уже выполняет другую задачу');

            return $wanted;
        }

        $free = array_values(array_diff(range(1, $size), $busy));
        abort_if(! $free, 409, $size === 1
            ? 'Агент уже выполняет задачу. Добавьте ещё одного агента, чтобы работать параллельно.'
            : "Все агенты заняты ({$size} из {$size}). Задача подождёт в очереди.");

        return $free[0];
    }
}
