<?php

namespace App\Services;

use App\Models\AiModel;
use Closure;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Шлюз к нейросетям — ЕДИНСТВЕННОЕ место, где сервер обращается к внешним провайдерам.
 * Все провайдеры говорят на одном протоколе OpenAI chat/completions, поэтому код один для всех.
 * API-ключи подставляются только здесь и никогда не уходят в браузер или приложение.
 * Здесь же: ожидание занятого бесплатного тарифа, распознавание дневного лимита и пустых ответов.
 */
class AiGateway
{
    /**
     * Отправить запрос «чат» нейросети и вернуть её ответ.
     *
     * @param  array<int, array<string, mixed>>  $messages  история в формате OpenAI: [{role, content}]
     * @param  array<int, array<string, mixed>>|null  $tools  инструменты агента (function calling)
     * @param  int|null  $maxWait  сколько секунд ждать занятый бесплатный тариф (у кого есть запасная модель — меньше)
     * @param  bool  $retryTimeouts  повторять ли запрос после таймаута
     * @return array{content: ?string, tool_calls: array, tokens: ?int, message: array}
     */
    public function chat(AiModel $model, array $messages, ?array $tools = null, array $extra = [], ?int $timeout = null, ?int $maxWait = null, bool $retryTimeouts = true): array
    {
        $provider = $this->provider($model->provider);
        // Провайдер уже исчерпал дневной лимит — даже не отправляем запрос.
        if ($until = Providers::exhaustedUntil($model->provider)) {
            throw new AiProviderException("Дневной лимит бесплатных запросов {$provider['title']} исчерпан до ".date('H:i', $until));
        }
        $messages = $this->withSystemPrompt($model, $messages); // правила платформы — первым системным сообщением

        $payload = ['model' => $model->model, 'messages' => $messages, ...$extra];
        if ($tools) {
            $payload['tools'] = $tools;
        }

        // withPatience — повторить запрос, если бесплатный тариф ответил «занят, повторите через N секунд».
        $response = $this->withPatience(fn () => $this->http($provider, $timeout)->post($provider['url'], $payload), $maxWait, $retryTimeouts);

        // Дневная квота закончилась — запоминаем до времени сброса, чтобы не спрашивать снова.
        if ($this->dailyQuotaUsed($response)) {
            $reset = (int) ($response->json('error.metadata.headers.X-RateLimit-Reset') ?? 0);
            Providers::markExhausted($model->provider, $reset > 0 ? intdiv($reset, 1000) : null);
            throw new AiProviderException("Дневной лимит бесплатных запросов {$provider['title']} исчерпан");
        }
        if (in_array($response->status(), [402, 429], true)) {
            throw new AiProviderException('Бесплатная нейросеть сейчас перегружена, повторите через минуту');
        }
        if ($response->failed()) {
            $detail = $response->json('error.message') ?? $response->json('message') ?? $response->json('0.error.message');
            throw new AiProviderException("Ошибка нейросети (HTTP {$response->status()})".($detail ? ': '.Str::limit((string) $detail, 160) : ''));
        }

        // Ответ в формате OpenAI: choices[0].message = {role, content, tool_calls}.
        $message = $response->json('choices.0.message');
        // Бесплатные роутеры иногда отвечают 200 с finish_reason "error" и пустым содержимым,
        // если модель упала посреди ответа: это ошибка, а не пустой ответ.
        $empty = ! is_array($message) || (blank($message['content'] ?? null) && empty($message['tool_calls']));
        if ($empty || $response->json('choices.0.finish_reason') === 'error') {
            throw new AiProviderException('Нейросеть вернула пустой ответ');
        }

        return [
            'content' => $message['content'] ?? null,
            'tool_calls' => $message['tool_calls'] ?? [],
            'tokens' => $response->json('usage.total_tokens'),
            'finish_reason' => $response->json('choices.0.finish_reason'), // "length" = ответ обрезан по длине
            'message' => array_intersect_key($message, array_flip(['role', 'content', 'tool_calls'])),
        ];
    }

    /**
     * Сгенерировать картинку (Pollinations) и сохранить файл в storage/app/public/images/ГГГГ/ММ/.
     *
     * @return string путь к файлу на диске public
     */
    public function image(AiModel $model, string $prompt, int $width = 1024, int $height = 1024): string
    {
        $provider = $this->provider($model->provider);
        if (empty($provider['image_url'])) {
            throw new AiProviderException("Провайдер {$model->provider} не умеет создавать изображения");
        }

        $response = $this->withPatience(fn () => $this->http($provider)->get($provider['image_url'].'/'.rawurlencode($prompt), [
            'model' => $model->model,
            'width' => $width,
            'height' => $height,
            'nologo' => 'true',
            'safe' => 'true', // фильтр 18+ на стороне провайдера — в дополнение к нашему ContentFilter
            'seed' => random_int(1, 999999), // случайное зерно: одинаковый запрос даёт разные картинки
        ]), maxWait: 100);

        if (in_array($response->status(), [402, 429], true)) {
            throw new AiProviderException('Генератор изображений перегружен, повторите через минуту');
        }
        if ($response->failed() || ! str_starts_with((string) $response->header('Content-Type'), 'image/')) {
            throw new AiProviderException("Не удалось создать изображение (HTTP {$response->status()})");
        }

        $path = 'images/'.now()->format('Y/m').'/'.Str::uuid().'.jpg'; // уникальное имя файла
        Storage::disk('public')->put($path, $response->body());

        return $path;
    }

    /**
     * Список моделей провайдера (для окна «Импорт моделей» в админ-панели и проверки ключа).
     * Отбрасываются модели не для чата (эмбеддинги, речь, модерация), у OpenRouter — платные.
     *
     * @return array<int, array{id: string, name: string}>
     */
    public function remoteModels(string $name): array
    {
        $provider = $this->provider($name);
        $response = $this->http($provider)->timeout(30)->get($provider['models_url']);
        if ($response->failed()) {
            throw new AiProviderException("Провайдер ответил HTTP {$response->status()}".($response->status() === 401 ? ' — неверный ключ' : ''));
        }

        $items = $response->json('data') ?? $response->json();
        $models = collect(is_array($items) ? $items : [])
            ->map(fn ($m) => [
                'id' => (string) ($m['id'] ?? $m['name'] ?? ''),
                'name' => (string) ($m['name'] ?? $m['display_name'] ?? $m['id'] ?? ''),
                'free' => ! isset($m['pricing']) || ((float) ($m['pricing']['prompt'] ?? 0) == 0 && (float) ($m['pricing']['completion'] ?? 0) == 0),
            ])
            ->filter(fn ($m) => $m['id'] !== '' && ! preg_match('/embed|whisper|tts|guard|moderation|audio|transcribe|image-gen|imagen|veo|aqa/i', $m['id']));

        if (! empty($provider['free_only'])) {
            $models = $models->filter(fn ($m) => $m['free']);
        }

        return $models->map(fn ($m) => ['id' => str_replace('models/', '', $m['id']), 'name' => $m['name']])
            ->unique('id')->sortBy('id')->values()->all();
    }

    /** Быстрая проверка модели живым вопросом: null — модель работает, иначе текст ошибки (используется в постмортеме). */
    public function ping(AiModel $model): ?string
    {
        try {
            if ($model->type === AiModel::TYPE_IMAGE) {
                return null; // image generation is too slow/limited to ping
            }
            // «Думающие» модели сначала тратят токены на рассуждение, поэтому запас 600 токенов.
            $reply = $this->chat($model, [['role' => 'user', 'content' => 'Ответь одним словом: ок']], extra: ['max_tokens' => 600]);

            return filled($reply['content']) || $reply['tool_calls'] ? null : 'пустой ответ';
        } catch (AiProviderException $e) {
            // «Занята» на бесплатном тарифе — временно и о самой модели ничего не говорит, её не выключаем.
            return str_contains($e->getMessage(), 'перегружена') ? null : $e->getMessage();
        }
    }

    /** Настройки провайдера; если ключа нет — понятная ошибка. */
    private function provider(string $name): array
    {
        $provider = Providers::get($name);
        if (! $provider || ! $provider['enabled']) {
            throw new AiProviderException("Провайдер {$name} не настроен — добавьте ключ в админ-панели");
        }

        return $provider;
    }

    /** HTTP-клиент Laravel: таймаут, JSON, заголовки для OpenRouter и ключ Bearer (если он есть). */
    private function http(array $provider, ?int $timeout = null): PendingRequest
    {
        return Http::timeout($timeout ?? config('ai.timeout'))
            ->acceptJson()
            ->withHeaders(['X-Title' => 'Mansur AI', 'HTTP-Referer' => config('app.url')])
            ->when($provider['key'], fn ($http) => $http->withToken($provider['key']));
    }

    /** Правила безопасности платформы (без мата и 18+) идут первыми в системном промпте КАЖДОГО запроса. */
    private function withSystemPrompt(AiModel $model, array $messages): array
    {
        $safety = config('ai.moderation.enabled') ? config('ai.moderation.safety_prompt') : '';

        if (($messages[0]['role'] ?? null) === 'system') {
            $messages[0]['content'] = trim($safety."\n\n".$messages[0]['content']);
        } else {
            $system = trim($safety."\n\n".($model->system_prompt ?? ''));
            if ($system !== '') {
                array_unshift($messages, ['role' => 'system', 'content' => $system]);
            }
        }

        return $messages;
    }

    /** Ответ «Rate limit exceeded: free-models-per-day» и похожие: квота на сегодня закончилась. */
    private function dailyQuotaUsed(Response $response): bool
    {
        return $response->status() === 429
            && (str_contains((string) $response->json('error.metadata.limit_source'), 'daily')
                || preg_match('/per[- ]day|daily (limit|quota)/i', (string) $response->json('error.message')));
    }

    /**
     * Отправить запрос с терпением: бесплатные тарифы отвечают 402/429 «занят, повторите через N секунд»
     * (Pollinations без ключа — 1 ответ в 45 с на IP сервера), а 500/502/503 бывают временно.
     * Ждём сколько просят, но не больше $maxWait секунд и не больше 4 попыток.
     *
     * @param  Closure  $send  функция, которая отправляет сам запрос
     */
    private function withPatience(Closure $send, ?int $maxWait = null, bool $retryTimeouts = true): Response
    {
        $maxWait ??= config('ai.max_wait');
        $waited = 0;
        for ($attempt = 1; ; $attempt++) {
            try {
                $response = $send();
            } catch (ConnectionException $e) {
                // Таймаут: если у вызывающего есть запасная модель — не повторяем, сразу отдаём ей.
                if ($attempt >= 3 || ! $retryTimeouts) {
                    throw new AiProviderException('Нейросеть не ответила вовремя', previous: $e);
                }
                sleep(2);

                continue;
            }

            $status = $response->status();
            $busy = in_array($status, [402, 429], true);
            if ($busy && $this->dailyQuotaUsed($response)) {
                return $response; // waiting won't help until tomorrow
            }
            if (! $busy && ! in_array($status, [500, 502, 503], true)) {
                return $response;
            }

            // Сколько ждать: «Retry after 25s» (заголовок или текст ошибки) — это остаток до конца паузы.
            // Полный период из текста («1 reply every 45 seconds») берём, только если остаток не назван:
            // раньше брали больший из двух, ждали 46 с вместо 25 и сразу сдавались (баг постмортема).
            $text = (string) $response->json('error.message', '');
            $retry = max((int) $response->header('Retry-After'), preg_match('/retry after (\d+)/i', $text, $m) ? (int) $m[1] : 0);
            $period = preg_match('/every (\d+) seconds?/i', $text, $m) ? (int) $m[1] : 0;
            $delay = $busy ? min(($retry > 1 ? $retry : max($period, 1)) + 1, 50) : 2;
            if ($attempt >= 4 || $waited + $delay > $maxWait) {
                return $response;
            }
            sleep($delay);
            $waited += $delay;
        }
    }
}
