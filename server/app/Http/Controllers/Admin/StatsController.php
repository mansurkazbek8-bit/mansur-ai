<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AgentPurchase;
use App\Models\AgentTask;
use App\Models\Chat;
use App\Models\Message;
use App\Models\SocialAccount;
use App\Models\UsageCounter;
use App\Models\User;
use App\Services\Presence;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;

/** Админ-панель → «Статистика»: пользователи, запросы по моделям и дням, кто онлайн, способы регистрации. */
class StatsController extends Controller
{
    /** GET /api/admin/stats?date_from=&date_to= — по умолчанию последние 30 дней. */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'date_from' => ['nullable', 'date'],
            'date_to' => ['nullable', 'date', 'after_or_equal:date_from'],
        ]);
        $from = $request->date('date_from') ?? now()->subDays(29)->startOfDay();
        $to = $request->date('date_to') ?? now();

        // Запросы и уникальные пользователи по каждой модели за период (JOIN + GROUP BY в SQL).
        $byModel = UsageCounter::query()
            ->join('ai_models', 'ai_models.id', '=', 'usage_counters.ai_model_id')
            ->whereBetween('usage_counters.date', [$from->toDateString(), $to->toDateString()])
            ->groupBy('ai_models.id', 'ai_models.name')
            ->selectRaw('ai_models.id, ai_models.name, sum(requests_count)::int as requests, count(distinct user_id)::int as users')
            ->orderByDesc('requests')
            ->get();

        // Запросы по дням — для графика.
        $byDay = UsageCounter::query()
            ->whereBetween('date', [$from->toDateString(), $to->toDateString()])
            ->groupBy('date')
            ->selectRaw('date, sum(requests_count)::int as requests')
            ->orderBy('date')
            ->get()
            ->map(fn ($r) => ['date' => $r->date->toDateString(), 'requests' => $r->requests]);

        return response()->json([
            'period' => ['from' => $from->toDateString(), 'to' => $to->toDateString()],
            'totals' => [
                'users' => User::count(),
                'chats' => Chat::count(),
                'messages' => Message::count(),
                'agent_tasks' => AgentTask::count(),
                'requests' => (int) $byModel->sum('requests'),
                'agents_sold' => AgentPurchase::paid()->where('amount', '>', 0)->count(),
                'agents_revenue' => (int) AgentPurchase::paid()->sum('amount'),
                'users_today' => User::where('created_at', '>=', today())->count(),
                'users_period' => User::whereBetween('created_at', [$from, $to])->count(),
                // Сколько людей хоть раз входили в Windows-приложение (у их токена есть право «agent»).
                'app_users' => (int) PersonalAccessToken::where('tokenable_type', User::class)
                    ->where('abilities', 'like', '%"agent"%')->distinct()->count('tokenable_id'),
                'buyers' => (int) AgentPurchase::paid()->where('amount', '>', 0)->distinct()->count('user_id'),
            ],
            'online' => Presence::counts(),       // сейчас онлайн: всего / на сайте / в приложении
            'online_users' => Presence::users(20),
            'signup' => [
                'email' => User::doesntHave('socialAccounts')->count(),
                ...SocialAccount::groupBy('provider')->selectRaw('provider, count(distinct user_id)::int as n')->pluck('n', 'provider')->all(),
            ],
            'by_model' => $byModel,
            'by_day' => $byDay,
        ]);
    }
}
