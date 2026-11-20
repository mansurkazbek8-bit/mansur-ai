<?php

namespace App\Services;

use App\Models\AiModel;
use App\Models\Chat;
use App\Models\Message;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * КЛЮЧЕВОЙ СЦЕНАРИЙ 1 — отправка сообщения нейросети с проверкой дневного лимита.
 * Порядок: модель доступна? → фильтр мата/18+ → транзакция { блокировка счётчика и проверка лимита →
 * сохранить вопрос → ответ нейросети (или запасной модели) → сохранить ответ → +1 к счётчику }.
 * Если нейросеть не ответила — транзакция откатывается и ЛИМИТ НЕ СПИСЫВАЕТСЯ.
 */
class MessageService
{
    /** Зависимости внедряются контейнером Laravel (dependency injection). */
    public function __construct(
        private readonly AiGateway $gateway,
        private readonly UsageService $usage,
        private readonly ContentFilter $filter,
        private readonly ImagePrompt $imagePrompt,
    ) {}

    /**
     * Отправить сообщение и получить ответ.
     *
     * @return array{user_message: Message, assistant_message: Message, remaining: int}
     */
    public function send(User $user, Chat $chat, string $content, ?int $modelId = null): array
    {
        $model = AiModel::find($modelId ?? $chat->ai_model_id);

        // Модель должна существовать, быть включённой, иметь ключ провайдера и не быть моделью агента.
        if (! $model || ! $model->is_active || ! $model->isProviderConfigured() || $model->type === AiModel::TYPE_AGENT) {
            abort(422, 'Модель недоступна');
        }

        // Правила платформы: без мата и 18+ — проверяем ДО отправки и до списания лимита (ответ 422).
        if ($reason = $this->filter->violation($content, image: $model->type === AiModel::TYPE_IMAGE)) {
            abort(422, $reason);
        }

        try {
            return DB::transaction(function () use ($user, $chat, $content, $model) {
                $counter = $this->usage->lockAndCheck($user, $model); // 429, если лимит на сегодня исчерпан

                $userMessage = $chat->messages()->create([
                    'ai_model_id' => $model->id,
                    'role' => 'user',
                    'content' => $content,
                ]);

                $reply = $model->type === AiModel::TYPE_IMAGE
                    ? $this->generateImage($chat, $model, $content)
                    : $this->generateText($chat, $model);

                $assistantMessage = $chat->messages()->create([
                    'ai_model_id' => $model->id,
                    'role' => 'assistant',
                    ...$reply,
                ]);

                $counter->increment('requests_count'); // лимит списывается только после успешного ответа

                if ($chat->ai_model_id !== $model->id) {
                    $chat->ai_model_id = $model->id;
                }
                // Первое сообщение становится названием чата.
                if ($chat->messages()->count() <= 2 && Str::startsWith($chat->title, 'Новый чат')) {
                    $chat->title = Str::limit(trim(preg_replace('/\s+/', ' ', $content)), 60, '…');
                }
                $chat->touch();
                $chat->save();

                return [
                    'user_message' => $userMessage,
                    'assistant_message' => $assistantMessage,
                    'remaining' => max(0, $model->daily_limit - $counter->requests_count),
                ];
            });
        } catch (AiProviderException $e) {
            // Транзакция откатилась — лимит не списан. Сохраняем вопрос со статусом failed, чтобы он не потерялся.
            $chat->messages()->create([
                'ai_model_id' => $model->id,
                'role' => 'user',
                'content' => $content,
                'status' => Message::STATUS_FAILED,
            ]);
            abort(502, $e->getMessage().'. Попробуйте ещё раз.');
        }
    }

    /** Текстовый ответ: последние 20 сообщений чата как контекст + системный промпт модели. */
    private function generateText(Chat $chat, AiModel $model): array
    {
        $history = $chat->messages()
            ->where('status', Message::STATUS_OK)
            ->latest('id')
            ->limit(config('ai.history'))
            ->get()
            ->reverse()
            ->map(fn (Message $m) => [
                'role' => $m->role,
                'content' => $m->image_path ? '[изображение: '.$m->content.']' : $m->content,
            ])
            ->values()
            ->all();
        // Инструкция выбранной модели идёт первой — запасная модель ответит в той же роли (например, «программист»).
        if (filled($model->system_prompt)) {
            array_unshift($history, ['role' => 'system', 'content' => $model->system_prompt]);
        }

        // Занятая бесплатная модель передаёт ответ другой — пользователь не остаётся без ответа (отказоустойчивость).
        $candidates = [$model, ...$this->substitutes($model)];
        foreach ($candidates as $i => $candidate) {
            $last = $i === count($candidates) - 1;
            try {
                // Не последняя модель ждёт занятый бесплатный тариф не больше 12 с — дальше быстрее спросить запасную.
                $reply = $this->gateway->chat($candidate, $history, maxWait: $last ? null : 12, retryTimeouts: $last);
                if (blank($reply['content'])) {
                    throw new AiProviderException('Нейросеть вернула пустой ответ');
                }

                // Ответ подписывается моделью, которая его НА САМОМ ДЕЛЕ написала; мат в ответе заменяется звёздочками.
                return ['content' => $this->filter->censor($reply['content']), 'tokens' => $reply['tokens'], 'ai_model_id' => $candidate->id];
            } catch (AiProviderException $e) {
                if ($last) {
                    throw $e;
                }
            }
        }
    }

    /**
     * Запасные модели: до двух других рабочих текстовых моделей, сначала у ДРУГИХ провайдеров
     * (если «лёг» провайдер целиком, модель того же провайдера не поможет).
     *
     * @return array<int, AiModel>
     */
    private function substitutes(AiModel $model): array
    {
        return AiModel::available()->where('type', AiModel::TYPE_TEXT)->whereKeyNot($model->id)->get()
            ->reject(fn (AiModel $m) => Providers::exhaustedUntil($m->provider))
            ->sortBy(fn (AiModel $m) => [$m->provider === $model->provider ? 1 : 0, $m->sort])
            ->take(2)->values()->all();
    }

    /** Картинка: запрос переводится в английский промпт (ImagePrompt), затем генерируется. */
    private function generateImage(Chat $chat, AiModel $model, string $prompt): array
    {
        // Прошлые картинки чата позволяют сказать «а теперь сделай её красной».
        $earlier = $chat->messages()->whereNotNull('image_path')->latest('id')->limit(2)->pluck('content')->reverse()->values()->all();

        return [
            'content' => $prompt,
            'image_path' => $this->gateway->image($model, $this->imagePrompt->english($prompt, $earlier)),
        ];
    }
}
