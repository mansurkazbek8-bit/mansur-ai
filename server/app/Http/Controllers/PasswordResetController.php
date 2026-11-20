<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\MailSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Password;
use Illuminate\Validation\Rules\Password as PasswordRule;
use Throwable;

/**
 * «Забыли пароль?»: письмо с одноразовой ссылкой → новый пароль на сайте.
 * Используется стандартный механизм Laravel Password Broker: токен сброса хранится
 * в таблице password_reset_tokens в виде хеша и действует 60 минут.
 */
class PasswordResetController extends Controller
{
    /** POST /api/forgot-password — отправить письмо со ссылкой сброса. */
    public function forgot(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'email', 'max:255']]);
        // 503 — почта ещё не настроена администратором (SMTP-настройки в админ-панели).
        abort_unless(MailSettings::ready(), 503, 'Отправка писем ещё не настроена. Напишите администратору сайта.');
        MailSettings::apply(); // подставить SMTP-настройки из админ-панели в конфигурацию Laravel

        // Поиск без учёта регистра: Ivan@Mail.ru и ivan@mail.ru — один и тот же адрес.
        $user = User::whereRaw('lower(email) = ?', [mb_strtolower(trim($data['email']))])->first();
        if ($user && ! $user->is_blocked) {
            try {
                // Broker сам не даст отправить второе письмо раньше чем через минуту (защита от спама).
                Password::broker()->sendResetLink(['email' => $user->email]);
            } catch (Throwable $e) {
                Log::error('Password reset mail failed: '.$e->getMessage());
                abort(502, 'Не удалось отправить письмо. Попробуйте позже.');
            }
        }

        // Ответ одинаковый, есть такой аккаунт или нет: по форме нельзя узнать, кто зарегистрирован.
        return response()->json(['message' => 'Если аккаунт с таким email есть, мы отправили на него письмо со ссылкой. Проверьте также папку «Спам».']);
    }

    /** POST /api/reset-password — сменить пароль по токену из письма и сразу войти. */
    public function reset(Request $request, AuthController $auth): JsonResponse
    {
        $data = $request->validate([
            'token' => ['required', 'string'],
            'email' => ['required', 'email'],
            'password' => ['required', 'confirmed', PasswordRule::min(8)], // confirmed — нужно поле password_confirmation
        ]);

        $user = null;
        $email = User::whereRaw('lower(email) = ?', [mb_strtolower(trim($data['email']))])->value('email') ?? $data['email'];
        $status = Password::broker()->reset(
            ['email' => $email, 'token' => $data['token'], 'password' => $data['password']],
            function (User $u, string $password) use (&$user) {
                $u->forceFill(['password' => $password])->save();
                $u->tokens()->delete(); // выход на всех устройствах: тот, кто знал старый пароль, теряет доступ
                $user = $u;
            },
        );

        if ($status !== Password::PASSWORD_RESET || ! $user) {
            abort(422, 'Ссылка устарела или уже использована. Запросите новое письмо.');
        }
        abort_if($user->is_blocked, 403, 'Аккаунт заблокирован администратором');

        return $auth->issueToken($user, 'web');
    }
}
