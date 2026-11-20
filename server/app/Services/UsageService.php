<?php

namespace App\Services;

use App\Models\AiModel;
use App\Models\UsageCounter;
use App\Models\User;
use Illuminate\Support\Collection;

/**
 * Сервис дневных лимитов: сколько бесплатных запросов к каждой модели пользователь может сделать сегодня.
 * Счётчик — строка usage_counters (пользователь, модель, дата). В 00:00 начинается новая дата — лимит «обновляется».
 */
class UsageService
{
    /**
     * Заблокировать сегодняшнюю строку счётчика (SELECT … FOR UPDATE) и вернуть 429, если лимит исчерпан.
     * Вызывается ТОЛЬКО внутри транзакции: пока она идёт, второй параллельный запрос того же пользователя
     * ждёт на блокировке и не сможет «проскочить» лимит (защита от гонки, race condition).
     */
    public function lockAndCheck(User $user, AiModel $model): UsageCounter
    {
        // Создать строку на сегодня, если её ещё нет.
        $counter = UsageCounter::firstOrCreate(
            ['user_id' => $user->id, 'ai_model_id' => $model->id, 'date' => today()->toDateString()],
            ['requests_count' => 0],
        );
        $counter = UsageCounter::whereKey($counter->id)->lockForUpdate()->first(); // блокировка строки до конца транзакции

        if ($counter->requests_count >= $model->daily_limit) {
            abort(429, "Дневной лимит модели «{$model->name}» исчерпан ({$model->daily_limit} запросов). Лимит обновится в 00:00.");
        }

        return $counter;
    }

    /** Сколько запросов к модели осталось сегодня. */
    public function remaining(User $user, AiModel $model): int
    {
        $used = UsageCounter::where('user_id', $user->id)
            ->where('ai_model_id', $model->id)
            ->whereDate('date', today())
            ->value('requests_count') ?? 0;

        return max(0, $model->daily_limit - $used);
    }

    /**
     * Сводка по всем доступным моделям для профиля: лимит, использовано, осталось.
     *
     * @return Collection<int, array{ai_model_id: int, name: string, type: string, daily_limit: int, used: int, remaining: int}>
     */
    public function summary(User $user): Collection
    {
        $used = UsageCounter::where('user_id', $user->id)
            ->whereDate('date', today())
            ->pluck('requests_count', 'ai_model_id');

        return AiModel::available()->get()->map(fn (AiModel $m) => [
            'ai_model_id' => $m->id,
            'name' => $m->name,
            'type' => $m->type,
            'daily_limit' => $m->daily_limit,
            'used' => (int) ($used[$m->id] ?? 0),
            'remaining' => max(0, $m->daily_limit - (int) ($used[$m->id] ?? 0)),
        ]);
    }
}
