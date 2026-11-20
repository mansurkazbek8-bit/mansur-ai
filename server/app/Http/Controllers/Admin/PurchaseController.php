<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AgentPurchase;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Админ-панель → «Покупки»: кто, какого агента, когда и за сколько купил + итоги. */
class PurchaseController extends Controller
{
    /** GET /api/admin/purchases?q= — список покупок (поиск по имени/email покупателя) и сводка. */
    public function index(Request $request): JsonResponse
    {
        $request->validate(['q' => ['nullable', 'string', 'max:100']]);
        $roster = config('agents.roster');

        // with('user:id,name,email') — загружаем только нужные поля покупателя.
        $query = AgentPurchase::query()->with('user:id,name,email')
            ->when($request->q, fn ($q, $s) => $q->whereHas('user', fn ($u) => $u
                ->where('email', 'ilike', '%'.addcslashes($s, '%_\\').'%')
                ->orWhere('name', 'ilike', '%'.addcslashes($s, '%_\\').'%')));

        $page = (clone $query)->latest('id')->paginate(30);

        $paid = AgentPurchase::paid();
        // Агрегация средствами SQL: сколько раз купили каждого агента и на какую сумму.
        $byAgent = (clone $paid)->groupBy('slot')->selectRaw('slot, count(*)::int as count, sum(amount)::int as amount')->orderBy('slot')->get()
            ->map(fn ($r) => ['slot' => $r->slot, 'agent' => $roster[$r->slot]['name'] ?? "#{$r->slot}", 'count' => $r->count, 'amount' => $r->amount]);

        return response()->json([
            'data' => $page->getCollection()->map(fn (AgentPurchase $p) => [
                'id' => $p->id,
                'user' => $p->user ? ['id' => $p->user->id, 'name' => $p->user->name, 'email' => $p->user->email] : null,
                'slot' => $p->slot,
                'agent' => $roster[$p->slot]['name'] ?? "#{$p->slot}",
                'color' => $roster[$p->slot]['color'] ?? null,
                'amount' => $p->amount,
                'currency' => $p->currency,
                'method' => match ($p->provider) {
                    'demo' => 'Оплата (демо-режим)',
                    'admin' => 'Подарок администратора',
                    default => $p->provider,
                },
                'status' => $p->status,
                'paid_at' => $p->paid_at ?? $p->created_at,
            ])->values(),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()],
            'summary' => [
                'count' => (clone $paid)->where('amount', '>', 0)->count(),
                'revenue' => (int) (clone $paid)->sum('amount'),
                'buyers' => (int) (clone $paid)->where('amount', '>', 0)->distinct()->count('user_id'),
                'by_agent' => $byAgent,
            ],
        ]);
    }
}
