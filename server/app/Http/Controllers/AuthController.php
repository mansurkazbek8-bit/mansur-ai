<?php

namespace App\Http\Controllers;

use App\Http\Requests\LoginRequest;
use App\Http\Requests\RegisterRequest;
use App\Http\Requests\UpdateProfileRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use App\Services\UsageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Контроллер аутентификации: регистрация, вход, выход, профиль.
 * Контроллер «тонкий»: данные уже проверил Form Request, здесь только действие и ответ.
 * Вход выдаёт токен Laravel Sanctum — клиент кладёт его в заголовок Authorization: Bearer <токен>.
 */
class AuthController extends Controller
{
    /** POST /api/register — создать пользователя (пароль хешируется моделью) и сразу выдать токен (201). */
    public function register(RegisterRequest $request): JsonResponse
    {
        // safe()->only — берём только проверенные поля, роль admin подставить через запрос нельзя.
        $user = User::create($request->safe()->only(['name', 'email', 'password']));

        return $this->issueToken($user, $request->input('client', 'web'), 201);
    }

    /** POST /api/login — проверить email и пароль, выдать токен. */
    public function login(LoginRequest $request): JsonResponse
    {
        $user = User::where('email', $request->email)->first();

        // Аккаунт создан через Google/GitHub — пароля у него нет, подсказываем, какой кнопкой войти.
        if ($user && $user->password === null) {
            $via = $user->socialAccounts()->pluck('provider')->map(fn ($p) => $p === 'github' ? 'GitHub' : ucfirst($p))->join(', ');
            throw ValidationException::withMessages(['email' => "Этот аккаунт создан через {$via} — войдите через эту кнопку. Пароль можно задать в профиле."]);
        }
        // Hash::check сравнивает введённый пароль с bcrypt-хешем. Текст ошибки одинаковый,
        // чтобы по нему нельзя было узнать, существует ли такой email.
        if (! $user || ! Hash::check($request->password, $user->password)) {
            throw ValidationException::withMessages(['email' => 'Неверный email или пароль']);
        }
        if ($user->is_blocked) {
            abort(403, 'Ваш аккаунт заблокирован администратором');
        }

        return $this->issueToken($user, $request->input('client', 'web'));
    }

    /** POST /api/logout — удалить токен этого устройства (ответ 204 без тела). */
    public function logout(Request $request): Response
    {
        $request->user()->currentAccessToken()->delete();

        return response()->noContent();
    }

    /** POST /api/logout-all — удалить все токены пользователя (выход на всех устройствах). */
    public function logoutAll(Request $request): Response
    {
        $request->user()->tokens()->delete();

        return response()->noContent();
    }

    /** POST /api/ping — «пульс» открытой вкладки раз в минуту: Sanctum обновляет last_used_at токена, и админ видит пользователя онлайн. */
    public function ping(): Response
    {
        return response()->noContent();
    }

    /** GET /api/me — профиль и сколько запросов осталось сегодня по каждой модели. */
    public function me(Request $request, UsageService $usage): JsonResponse
    {
        return response()->json([
            'user' => new UserResource($request->user()),
            'usage' => $usage->summary($request->user()),
        ]);
    }

    /** PATCH /api/me — сменить имя и/или пароль. */
    public function update(UpdateProfileRequest $request): UserResource
    {
        $request->user()->update($request->safe()->only(['name', 'password']));

        return new UserResource($request->user());
    }

    /** Выдать новый токен Sanctum. Используется при регистрации, входе, входе через соцсети и сбросе пароля. */
    public function issueToken(User $user, string $client, int $status = 200): JsonResponse
    {
        // Права токена (abilities): сайт получает только «user», Windows-приложение ещё и «agent» —
        // только с ним можно брать и выполнять задачи на компьютере.
        $abilities = $client === 'desktop' ? ['user', 'agent'] : ['user'];
        $token = $user->createToken($client === 'desktop' ? 'Windows-приложение' : 'Сайт', $abilities);

        return response()->json([
            'user' => new UserResource($user),
            'token' => $token->plainTextToken, // открытый токен показывается один раз, в БД хранится его SHA-256 хеш
        ], $status);
    }
}
