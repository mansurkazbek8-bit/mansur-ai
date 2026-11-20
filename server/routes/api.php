<?php

/*
|--------------------------------------------------------------------------
| Маршруты REST API (все адреса начинаются с /api)
|--------------------------------------------------------------------------
| Здесь описано, какой URL и HTTP-метод какой метод контроллера вызывает.
| Сайт (public/js/app.js) и Windows-приложение (desktop/) работают только через эти маршруты,
| обмениваясь JSON. Доступ разделён на 4 уровня: гость → пользователь → приложение (агент) → администратор.
| Middleware (посредники) проверяют запрос ДО контроллера:
|   throttle:auth   — не больше 10 попыток входа в минуту с одного IP (защита от подбора пароля);
|   auth:sanctum    — в заголовке Authorization должен быть действительный токен Sanctum, иначе 401;
|   not.blocked     — заблокированный администратором пользователь получает 403;
|   ability:user    — у токена есть право «user» (выдаётся при входе на сайт и в приложение);
|   abilities:agent — право «agent» есть только у токена Windows-приложения;
|   role:admin      — роль пользователя «admin», иначе 403.
*/

use App\Http\Controllers\Admin;
use App\Http\Controllers\Agent\AgentController;
use App\Http\Controllers\AgentTaskController;
use App\Http\Controllers\AgentTeamController;
use App\Http\Controllers\AiModelController;
use App\Http\Controllers\AppearanceController;
use App\Http\Controllers\AppInfoController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\ChatController;
use App\Http\Controllers\MessageController;
use App\Http\Controllers\PasswordResetController;
use App\Http\Controllers\SocialAuthController;
use App\Http\Controllers\UsageController;
use Illuminate\Support\Facades\Route;

// ---- Гость (без входа) ----
// Формы входа ограничены строже: 10 попыток в минуту с одного IP — подбор пароля и рассылка писем останавливаются.
Route::middleware('throttle:auth')->group(function () {
    Route::post('/register', [AuthController::class, 'register']);              // регистрация → токен
    Route::post('/login', [AuthController::class, 'login']);                    // вход по email и паролю → токен
    Route::post('/oauth/exchange', [SocialAuthController::class, 'exchange']);   // одноразовый код после Google/GitHub → токен
    Route::post('/forgot-password', [PasswordResetController::class, 'forgot']); // письмо со ссылкой сброса пароля
    Route::post('/reset-password', [PasswordResetController::class, 'reset']);   // новый пароль по ссылке из письма
});
Route::get('/oauth/providers', [SocialAuthController::class, 'providers']); // какие кнопки «Войти через…» показать
Route::get('/models', [AiModelController::class, 'index']);                 // каталог доступных нейросетей
Route::get('/app', [AppInfoController::class, 'show']);                     // версия и ссылка на установщик приложения
Route::get('/agents', [AgentTeamController::class, 'index']);               // каталог агентов команды

// ---- Пользователь (сайт и Windows-приложение) ----
Route::middleware(['auth:sanctum', 'not.blocked', 'ability:user'])->group(function () {
    Route::get('/me', [AuthController::class, 'me']);                 // профиль текущего пользователя
    Route::patch('/me', [AuthController::class, 'update']);           // смена имени / email / пароля
    Route::post('/logout', [AuthController::class, 'logout']);        // удалить текущий токен
    Route::post('/logout-all', [AuthController::class, 'logoutAll']); // выйти на всех устройствах
    Route::post('/ping', [AuthController::class, 'ping']);            // «я онлайн» раз в минуту (для админ-статистики)
    Route::put('/me/appearance', [AppearanceController::class, 'update']);           // цвета и тема оформления
    Route::post('/me/background', [AppearanceController::class, 'uploadBackground']); // свой фон: фото, GIF, видео
    Route::delete('/me/background', [AppearanceController::class, 'deleteBackground']);

    // apiResource создаёт 5 маршрутов: GET /chats, POST /chats, GET/PUT(PATCH)/DELETE /chats/{chat}
    Route::apiResource('chats', ChatController::class);
    Route::post('/chats/{chat}/messages', [MessageController::class, 'store']); // КЛЮЧЕВОЙ СЦЕНАРИЙ 1: сообщение нейросети
    Route::get('/usage', [UsageController::class, 'index']);                    // сколько запросов осталось сегодня

    Route::post('/agents/buy', [AgentTeamController::class, 'buy']); // купить агента в команду (демо-оплата)

    // КЛЮЧЕВОЙ СЦЕНАРИЙ 2: задачи для ИИ-агента (создаются на сайте, выполняются приложением на ПК)
    Route::get('/agent-tasks', [AgentTaskController::class, 'index']);
    Route::post('/agent-tasks', [AgentTaskController::class, 'store']);
    Route::get('/agent-tasks/{task}', [AgentTaskController::class, 'show'])->name('agent-tasks.show');
    Route::post('/agent-tasks/{task}/cancel', [AgentTaskController::class, 'cancel']);

    // ---- Только Windows-приложение (у токена есть право «agent») ----
    Route::middleware('abilities:agent')->prefix('agent')->group(function () {
        Route::get('/tasks', [AgentController::class, 'tasks']);                     // задачи в очереди
        Route::get('/tasks/{task}/status', [AgentController::class, 'status']);      // не отменил ли пользователь задачу
        Route::post('/tasks/{task}/start', [AgentController::class, 'start']);       // queued → running
        Route::post('/tasks/{task}/logs', [AgentController::class, 'log']);          // запись шагов в журнал
        Route::post('/tasks/{task}/slot', [AgentController::class, 'slot']);         // какой агент команды занят задачей
        Route::post('/tasks/{task}/complete', [AgentController::class, 'complete']); // running → completed
        Route::post('/tasks/{task}/fail', [AgentController::class, 'fail']);         // running → failed
        Route::post('/step', [AgentController::class, 'step']);                      // один шаг «мышления» агента через сервер
        Route::post('/image', [AgentController::class, 'image']);                    // картинка для сайта, который делает агент
    });

    // ---- Администратор ----
    Route::middleware('role:admin')->prefix('admin')->group(function () {
        Route::post('/models/import', [Admin\AiModelController::class, 'import']);           // добавить модели из списка провайдера
        Route::get('/providers', [Admin\ProviderController::class, 'index']);                // провайдеры и состояние ключей
        Route::put('/providers/{provider}', [Admin\ProviderController::class, 'update']);    // сохранить API-ключ (шифруется)
        Route::get('/providers/{provider}/models', [Admin\ProviderController::class, 'models']);
        Route::post('/providers/{provider}/check', [Admin\ProviderController::class, 'check']); // проверить модели живым запросом
        Route::apiResource('models', Admin\AiModelController::class)
            ->parameters(['models' => 'aiModel'])->except('show');                         // CRUD нейросетей и лимитов
        Route::get('/social', [Admin\SocialAuthController::class, 'index']);                 // ключи входа через Google/GitHub
        Route::put('/social/{provider}', [Admin\SocialAuthController::class, 'update']);
        Route::get('/users', [Admin\UserController::class, 'index']);                        // все пользователи с данными
        Route::post('/users/{user}/block', [Admin\UserController::class, 'block']);
        Route::post('/users/{user}/unblock', [Admin\UserController::class, 'unblock']);
        Route::put('/users/{user}/agents', [Admin\UserController::class, 'agents']);         // выдать / забрать агентов
        Route::get('/stats', [Admin\StatsController::class, 'index']);                       // статистика и кто онлайн
        Route::get('/purchases', [Admin\PurchaseController::class, 'index']);                // кто что купил
        Route::get('/mail', [Admin\MailController::class, 'index']);                         // настройки почты (без пароля)
        Route::put('/mail', [Admin\MailController::class, 'update']);
        Route::post('/mail/test', [Admin\MailController::class, 'test']);                    // тестовое письмо
    });
});
