<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreChatRequest;
use App\Http\Requests\UpdateChatRequest;
use App\Http\Resources\ChatResource;
use App\Models\Chat;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * Контроллер чатов: список с поиском и фильтрами, создание, просмотр, переименование, удаление.
 * Gate::authorize вызывает ChatPolicy: чужой чат — 403.
 */
class ChatController extends Controller
{
    /** GET /api/chats?q=&ai_model_id=&date_from=&date_to= — чаты пользователя, по 30 на страницу. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'ai_model_id' => ['nullable', 'integer'],
            'date_from' => ['nullable', 'date'],
            'date_to' => ['nullable', 'date'],
        ]);

        $chats = $request->user()->chats()
            ->with('aiModel')          // жадная загрузка: модели всех чатов одним запросом (нет проблемы N+1)
            ->withCount('messages')    // число сообщений считает сама БД
            ->when($request->q, function ($query, $q) {
                // Экранируем % и _, чтобы они искались как обычные символы. ilike — поиск без учёта регистра (PostgreSQL).
                $like = '%'.addcslashes($q, '%_\\').'%';
                $query->where(fn ($w) => $w->where('title', 'ilike', $like)
                    ->orWhereHas('messages', fn ($m) => $m->where('content', 'ilike', $like)));
            })
            ->when($request->ai_model_id, fn ($query, $id) => $query->where('ai_model_id', $id))
            ->when($request->date_from, fn ($query, $d) => $query->whereDate('updated_at', '>=', $d))
            ->when($request->date_to, fn ($query, $d) => $query->whereDate('updated_at', '<=', $d))
            ->latest('updated_at')
            ->paginate(30);            // постраничный вывод

        return ChatResource::collection($chats);
    }

    /** POST /api/chats — новый чат с выбранной нейросетью. */
    public function store(StoreChatRequest $request): ChatResource
    {
        $chat = $request->user()->chats()->create([
            'title' => $request->title ?: 'Новый чат',
            'ai_model_id' => $request->ai_model_id,
        ]);

        return new ChatResource($chat->load('aiModel'));
    }

    /** GET /api/chats/{chat} — чат со всеми сообщениями. {chat} Laravel сам находит в БД (route model binding). */
    public function show(Chat $chat): ChatResource
    {
        Gate::authorize('view', $chat);

        return new ChatResource($chat->load(['aiModel', 'messages.aiModel']));
    }

    /** PATCH /api/chats/{chat} — переименовать чат или сменить нейросеть. */
    public function update(UpdateChatRequest $request, Chat $chat): ChatResource
    {
        Gate::authorize('update', $chat);
        $chat->update($request->validated());

        return new ChatResource($chat->load('aiModel'));
    }

    /** DELETE /api/chats/{chat} — удалить чат (сообщения удалятся каскадно внешним ключом). */
    public function destroy(Chat $chat): Response
    {
        Gate::authorize('delete', $chat);
        $chat->delete();

        return response()->noContent();
    }
}
