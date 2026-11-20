<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreAgentTaskRequest;
use App\Http\Resources\AgentTaskResource;
use App\Models\AgentTask;
use App\Services\AgentTaskService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/** Tasks for the Windows agent, as seen by the user (site or app). */
class AgentTaskController extends Controller
{
    public function index(Request $request, AgentTaskService $service): AnonymousResourceCollection
    {
        $request->validate(['status' => ['nullable', Rule::in(['queued', 'running', 'completed', 'failed', 'cancelled'])]]);
        $service->expireStale($request->user()); // «зависшие» задачи сначала закрываются, потом показывается список

        return AgentTaskResource::collection(
            $request->user()->agentTasks()
                ->whereNull('parent_id') // parts of "together" tasks are shown inside their parent
                ->with('subtasks')
                ->when($request->status, fn ($q, $s) => $q->where('status', $s))
                ->latest()
                ->paginate(20)
        );
    }

    public function store(StoreAgentTaskRequest $request, AgentTaskService $service): AgentTaskResource
    {
        return new AgentTaskResource($service->create($request->user(), $request->validated()));
    }

    public function show(AgentTask $task): AgentTaskResource
    {
        Gate::authorize('view', $task);

        return new AgentTaskResource($task->load('subtasks'));
    }

    public function cancel(AgentTask $task, AgentTaskService $service): AgentTaskResource
    {
        Gate::authorize('update', $task);

        return new AgentTaskResource($service->transition($task, AgentTask::CANCELLED, 'Отменено пользователем'));
    }
}
