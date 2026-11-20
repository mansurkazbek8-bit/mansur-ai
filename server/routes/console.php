<?php

/*
| Консольные команды Artisan (запускаются в терминале: php artisan <команда>).
*/

use App\Models\User;
use App\Services\MailSettings;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Hash;

// Стандартная команда-пример Laravel: выводит цитату.
Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// php artisan mansur:check-public — проверка безопасности ПЕРЕД публикацией сайта в интернет.
// Её вызывает runtime/publish.ps1 и скрипт установки на VPS; при ошибке публикация останавливается (код выхода 1).
Artisan::command('mansur:check-public', function () {
    $ok = true;
    // Ищем администраторов со стандартным паролем: Hash::check сравнивает пароль с bcrypt-хешем из БД.
    $weak = User::where('role', User::ROLE_ADMIN)->get()
        ->filter(fn (User $u) => $u->password && collect(['admin12345', 'password', '12345678', 'admin123'])->contains(fn ($p) => Hash::check($p, $u->password)));
    foreach ($weak as $u) {
        $this->error("У администратора {$u->email} стандартный пароль. Войдите на сайт и смените его в профиле (не короче 8 символов).");
        $ok = false;
    }
    // Режим отладки показывает посетителю подробности ошибки (пути, ключи) — в интернете он должен быть выключен.
    if (config('app.debug')) {
        $this->error('Включён режим отладки APP_DEBUG=true: при ошибке посетители увидят секретные ключи. Поставьте APP_DEBUG=false в server/.env.');
        $ok = false;
    }
    // Почта не обязательна, поэтому только предупреждение.
    if (! MailSettings::ready()) {
        $this->warn('Почта не настроена: «Забыли пароль?» не будет отправлять письма (Админ-панель → Почта).');
    }

    if ($ok) {
        $this->info('Проверка пройдена: сайт можно открывать в интернет.');
    }

    return $ok ? 0 : 1;
})->purpose('Проверить, что сайт безопасно открывать в интернет');

// php artisan mansur:admin-password — задать новый пароль администратору, если старый забыт.
// Пароль вводится скрыто (не виден на экране и не попадает в историю команд), сохраняется как bcrypt-хеш.
Artisan::command('mansur:admin-password {email? : email администратора}', function () {
    $admins = User::where('role', User::ROLE_ADMIN)->orderBy('id')->get();
    $email = $this->argument('email') ?: ($admins->count() === 1 ? $admins->first()->email
        : $this->choice('Какому администратору сменить пароль?', $admins->pluck('email')->all()));
    $user = $admins->firstWhere('email', $email);
    if (! $user) {
        $this->error("Администратор {$email} не найден.");

        return 1;
    }
    $this->info("Администратор: {$user->email}");
    $password = $this->secret('Новый пароль (не короче 8 символов, ввод не отображается)');
    if (mb_strlen((string) $password) < 8) {
        $this->error('Пароль короче 8 символов — ничего не изменено.');

        return 1;
    }
    if ($this->secret('Повторите пароль') !== $password) {
        $this->error('Пароли не совпали — ничего не изменено.');

        return 1;
    }
    $user->forceFill(['password' => $password])->save(); // хешируется автоматически (cast 'hashed')
    $user->tokens()->delete(); // старые входы на всех устройствах завершаются
    $this->info('Пароль изменён. Войдите на сайте: '.$user->email);

    return 0;
})->purpose('Задать новый пароль администратору');
