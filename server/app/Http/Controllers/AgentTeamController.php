<?php

namespace App\Http\Controllers;

use App\Services\AgentTeam;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Команда ИИ-агентов пользователя: каталог и покупка новых агентов (логика — в сервисе AgentTeam). */
class AgentTeamController extends Controller
{
    public function index(Request $request, AgentTeam $team): JsonResponse
    {
        // GET /api/agents: гость видит каталог на главной странице, вошедший — ещё и своих агентов.
        // user('sanctum') — пользователь по токену, если он есть (маршрут открыт и для гостей).
        return response()->json($team->overview($request->user('sanctum')));
    }

    /** POST /api/agents/buy — купить следующего агента (демо-оплата, записывается в agent_purchases). */
    public function buy(Request $request, AgentTeam $team): JsonResponse
    {
        $purchase = $team->buyNext($request->user());
        $agent = AgentTeam::roster()[$purchase->slot];

        return response()->json([
            'message' => "{$agent['name']} присоединился к команде! Теперь агентов: {$purchase->slot}.",
            ...$team->overview($request->user()),
        ], 201);
    }
}
