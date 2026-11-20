<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreMessageRequest;
use App\Http\Resources\MessageResource;
use App\Models\Chat;
use App\Services\MessageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

/**
 * КЛЮЧЕВОЙ СЦЕНАРИЙ 1 — отправка сообщения нейросети.
 * Контроллер только проверяет право на чат и передаёт работу сервису MessageService
 * (лимит, фильтр, запрос к нейросети, запасная модель — всё там).
 */
class MessageController extends Controller
{
    /** POST /api/chats/{chat}/messages — ответ 201: сообщение пользователя, ответ нейросети и остаток лимита. */
    public function store(StoreMessageRequest $request, Chat $chat, MessageService $service): JsonResponse
    {
        Gate::authorize('update', $chat); // писать можно только в свой чат

        $result = $service->send($request->user(), $chat, $request->input('content'), $request->integer('ai_model_id') ?: null);

        return response()->json([
            'user_message' => new MessageResource($result['user_message']->load('aiModel')),
            'assistant_message' => new MessageResource($result['assistant_message']->load('aiModel')),
            'remaining' => $result['remaining'],
            'chat' => ['id' => $chat->id, 'title' => $chat->title, 'ai_model_id' => $chat->ai_model_id],
        ], 201);
    }
}
