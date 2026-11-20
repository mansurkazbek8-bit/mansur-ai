<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Services\AgentTeam;
use App\Services\Presence;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/** Админ-панель → «Пользователи»: поиск, фильтры, блокировка и выдача агентов. */
class UserController extends Controller
{
    /** GET /api/admin/users?q=&blocked=&online=&sort=new|seen|spent — все пользователи с данными активности. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'blocked' => ['nullable', 'boolean'],
            'online' => ['nullable', 'boolean'],
            'sort' => ['nullable', 'in:new,seen,spent'],
        ]);

        return UserResource::collection(
            self::withAdminData(User::query())
                ->when($request->q, fn ($q, $s) => $q->where(fn ($w) => $w
                    ->where('email', 'ilike', '%'.addcslashes($s, '%_\\').'%')
                    ->orWhere('name', 'ilike', '%'.addcslashes($s, '%_\\').'%')))
                ->when($request->has('blocked'), fn ($q) => $q->where('is_blocked', $request->boolean('blocked')))
                ->when($request->boolean('online'), fn ($q) => $q->whereHas('tokens', fn ($t) => $t->where('last_used_at', '>=', now()->subMinutes(Presence::MINUTES))))
                ->when($request->sort === 'seen', fn ($q) => $q->orderByRaw('tokens_max_last_used_at desc nulls last'))
                ->when($request->sort === 'spent', fn ($q) => $q->orderByRaw('spent desc nulls last'))
                ->latest()
                ->paginate(30)
        );
    }

    /**
     * Всё для таблицы админа одним SQL-запросом с подзапросами: число чатов и задач,
     * когда был в сети (max last_used_at токенов), пользуется ли приложением, способ входа, сколько потратил.
     */
    public static function withAdminData($query)
    {
        return $query
            ->with('socialAccounts:id,user_id,provider')
            ->withCount(['chats', 'agentTasks', 'agentPurchases as paid_agents_count' => fn ($q) => $q->paid()])
            ->withMax('tokens', 'last_used_at')
            ->withExists(['tokens as uses_app' => fn ($q) => $q->where('abilities', 'like', '%"agent"%')])
            ->withSum(['agentPurchases as spent' => fn ($q) => $q->paid()], 'amount')
            ->withSum('usageCounters as requests_total', 'requests_count');
    }

    /** POST /api/admin/users/{user}/block — заблокировать и сразу удалить все его токены (выкинуть со всех устройств). */
    public function block(Request $request, User $user): UserResource
    {
        if ($user->is($request->user())) {
            abort(422, 'Нельзя заблокировать самого себя');
        }
        $user->forceFill(['is_blocked' => true])->save();
        $user->tokens()->delete();

        return new UserResource($user);
    }

    /** POST /api/admin/users/{user}/unblock — разблокировать. */
    public function unblock(User $user): UserResource
    {
        $user->forceFill(['is_blocked' => false])->save();

        return new UserResource($user);
    }

    /** PUT /api/admin/users/{user}/agents — подарить или забрать агентов (задать размер команды). */
    public function agents(Request $request, User $user, AgentTeam $team): UserResource
    {
        $request->validate(['count' => ['required', 'integer', 'min:1', 'max:'.AgentTeam::max()]]);
        $team->setSize($user, $request->integer('count'));

        return new UserResource(self::withAdminData(User::whereKey($user->id))->first());
    }
}
