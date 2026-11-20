<?php

namespace App\Http\Controllers;

use App\Services\UsageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** GET /api/usage — сколько запросов к каждой нейросети осталось у пользователя сегодня. */
class UsageController extends Controller
{
    public function index(Request $request, UsageService $usage): JsonResponse
    {
        return response()->json(['data' => $usage->summary($request->user())]);
    }
}
