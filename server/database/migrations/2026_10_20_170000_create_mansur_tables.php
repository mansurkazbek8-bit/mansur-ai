<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Главная миграция: создаёт таблицы предметной области Mansur AI.
 * Миграция = описание структуры БД кодом; php artisan migrate применяет её, migrate:rollback откатывает (down).
 * foreignId(...)->constrained() — внешний ключ на таблицу; cascadeOnDelete — при удалении родителя удаляются
 * и дочерние строки; nullOnDelete — ссылка обнуляется (сообщения не пропадают при удалении модели).
 */
return new class extends Migration
{
    /** Применить: создать таблицы. */
    public function up(): void
    {
        // users создаёт стандартная миграция Laravel; добавляем роль и признак блокировки.
        Schema::table('users', function (Blueprint $table) {
            $table->string('role', 20)->default('user')->after('password');
            $table->boolean('is_blocked')->default(false)->after('role');
        });

        // Каталог нейросетей.
        Schema::create('ai_models', function (Blueprint $table) {
            $table->id();
            $table->string('slug', 60)->unique();     // короткое уникальное имя, например mansur-chat
            $table->string('name', 100);
            $table->string('provider', 30);           // pollinations, openrouter, gemini…
            $table->string('model', 150);             // id модели у провайдера
            $table->string('type', 20)->default('text'); // text | image | agent
            $table->string('description', 255)->nullable();
            $table->text('system_prompt')->nullable();
            $table->unsignedInteger('daily_limit')->default(50); // запросов в день на пользователя
            $table->boolean('is_active')->default(true);
            $table->unsignedSmallInteger('sort')->default(0);
            $table->timestamps();
        });

        // Чаты пользователей.
        Schema::create('chats', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('ai_model_id')->nullable()->constrained()->nullOnDelete();
            $table->string('title', 150);
            $table->timestamps();
            $table->index(['user_id', 'updated_at']); // индекс для быстрого списка «мои чаты, свежие сверху»
        });

        // Сообщения чатов (вопросы пользователя и ответы нейросетей).
        Schema::create('messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('chat_id')->constrained()->cascadeOnDelete();
            $table->foreignId('ai_model_id')->nullable()->constrained()->nullOnDelete();
            $table->string('role', 20); // user | assistant
            $table->text('content');
            $table->string('image_path')->nullable();
            $table->string('status', 20)->default('ok'); // ok | failed
            $table->unsignedInteger('tokens')->nullable();
            $table->timestamps();
        });

        // Задачи ИИ-агента (ключевой сценарий 2).
        Schema::create('agent_tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title', 150);
            $table->text('prompt');
            $table->string('workspace')->nullable();
            $table->string('status', 20)->default('queued'); // queued | running | completed | failed | cancelled
            $table->jsonb('log')->default('[]'); // журнал шагов — массив JSON (тип jsonb есть в PostgreSQL)
            $table->text('result')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();
            $table->index(['user_id', 'status']);
        });

        // Счётчики дневных лимитов (ключевой сценарий 1).
        Schema::create('usage_counters', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('ai_model_id')->constrained()->cascadeOnDelete();
            $table->date('date');
            $table->unsignedInteger('requests_count')->default(0);
            $table->timestamps();
            $table->unique(['user_id', 'ai_model_id', 'date']); // одна строка на пользователя, модель и день
        });
    }

    /** Откатить: удалить таблицы в обратном порядке (сначала зависимые). */
    public function down(): void
    {
        Schema::dropIfExists('usage_counters');
        Schema::dropIfExists('agent_tasks');
        Schema::dropIfExists('messages');
        Schema::dropIfExists('chats');
        Schema::dropIfExists('ai_models');
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn(['role', 'is_blocked']));
    }
};
