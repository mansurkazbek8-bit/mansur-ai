<?php

namespace App\Http\Controllers\Agent;

use App\Http\Controllers\Controller;
use App\Http\Requests\AgentLogRequest;
use App\Http\Requests\AgentStepRequest;
use App\Http\Resources\AgentTaskResource;
use App\Models\AgentTask;
use App\Models\AiModel;
use App\Services\AgentTaskService;
use App\Services\AgentTeam;
use App\Services\AiGateway;
use App\Services\AiProviderException;
use App\Services\ContentFilter;
use App\Services\ImagePrompt;
use App\Services\UsageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;

/**
 * Адреса только для Windows-приложения (у токена есть право «agent»).
 * Приложение забирает задачи из очереди, переводит их по статусам, пишет журнал шагов
 * и просит сервер сделать один «шаг мышления» агента — ключи нейросетей остаются на сервере.
 */
class AgentController extends Controller
{
    /** Внедрение зависимости: Laravel сам создаёт AgentTaskService и передаёт его в конструктор. */
    public function __construct(private readonly AgentTaskService $service) {}

    /** GET /api/agent/tasks — до 10 самых старых задач в очереди (сначала давно ждущие). */
    public function tasks(Request $request): AnonymousResourceCollection
    {
        return AgentTaskResource::collection(
            $request->user()->agentTasks()
                ->where('status', $request->input('status', AgentTask::QUEUED))
                ->oldest()
                ->limit(10)
                ->get()
        );
    }

    /** POST /api/agent/tasks/{task}/start — взять задачу в работу: queued → running, занять агента (слот). */
    public function start(Request $request, AgentTask $task): AgentTaskResource
    {
        Gate::authorize('update', $task);
        $request->validate(['slot' => ['nullable', 'integer', 'min:1', 'max:'.AgentTeam::max()]]);

        return new AgentTaskResource($this->service->transition($task, AgentTask::RUNNING, slot: $request->integer('slot') ?: null));
    }

    /** POST /api/agent/tasks/{task}/slot — освободить агента задачи (slot = null) или занять свободного. */
    public function slot(Request $request, AgentTask $task): AgentTaskResource
    {
        Gate::authorize('update', $task);
        $request->validate(['slot' => ['nullable', 'integer', 'min:1', 'max:'.AgentTeam::max()]]);

        return new AgentTaskResource($this->service->reassign($task, $request->integer('slot') ?: null));
    }

    /** POST /api/agent/tasks/{task}/logs — дописать шаги в журнал (только у задачи в статусе running). */
    public function log(AgentLogRequest $request, AgentTask $task): AgentTaskResource
    {
        Gate::authorize('update', $task);

        return new AgentTaskResource($this->service->appendLog($task, $request->validated('entries')));
    }

    /** POST /api/agent/tasks/{task}/complete — задача выполнена: running → completed + итог. */
    public function complete(Request $request, AgentTask $task): AgentTaskResource
    {
        Gate::authorize('update', $task);
        $request->validate(['result' => ['nullable', 'string', 'max:20000']]);

        return new AgentTaskResource($this->service->transition($task, AgentTask::COMPLETED, $request->input('result')));
    }

    /** POST /api/agent/tasks/{task}/fail — не получилось: running → failed + причина. */
    public function fail(Request $request, AgentTask $task): AgentTaskResource
    {
        Gate::authorize('update', $task);
        $request->validate(['result' => ['nullable', 'string', 'max:20000']]);

        return new AgentTaskResource($this->service->transition($task, AgentTask::FAILED, $request->input('result')));
    }

    /** GET /api/agent/tasks/{task}/status — приложение проверяет, не отменил ли пользователь задачу на сайте. */
    public function status(AgentTask $task): JsonResponse
    {
        Gate::authorize('view', $task);

        return response()->json(['status' => $task->status]);
    }

    /** POST /api/agent/step — один шаг агента: история + инструменты → ответ модели (текст или вызов инструмента). */
    public function step(AgentStepRequest $request): JsonResponse
    {
        return response()->json($this->service->step($request->user(), $request->input('messages'), $request->input('tools')));
    }

    /** POST /api/agent/image — картинка для сайта, который делает агент (лимит модели картинок списывается как в чате). */
    public function image(Request $request, AiGateway $gateway, UsageService $usage, ContentFilter $filter, ImagePrompt $imagePrompt): JsonResponse
    {
        $request->validate([
            'prompt' => ['required', 'string', 'max:2000'],
            'width' => ['nullable', 'integer', 'min:64', 'max:2048'],
            'height' => ['nullable', 'integer', 'min:64', 'max:2048'],
        ]);
        if ($reason = $filter->violation($request->prompt, image: true)) {
            abort(422, $reason);
        }
        $model = AiModel::where('type', AiModel::TYPE_IMAGE)->available()->first() ?? abort(422, 'Генератор изображений недоступен');

        try {
            // Транзакция: если генерация упала, увеличение счётчика откатится — лимит не списан.
            $path = DB::transaction(function () use ($request, $gateway, $usage, $model, $imagePrompt) {
                $counter = $usage->lockAndCheck($request->user(), $model);
                $path = $gateway->image($model, $imagePrompt->english($request->prompt), $request->integer('width', 1024), $request->integer('height', 1024));
                $counter->increment('requests_count');

                return $path;
            });
        } catch (AiProviderException $e) {
            abort(502, $e->getMessage());
        }

        return response()->json(['url' => Storage::disk('public')->url($path)], 201);
    }
}
