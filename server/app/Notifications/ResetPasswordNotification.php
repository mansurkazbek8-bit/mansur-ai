<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Письмо «Сброс пароля» со ссылкой; ссылка открывает сайт, и он показывает форму нового пароля. */
class ResetPasswordNotification extends Notification
{
    /** $token — одноразовый токен сброса (в БД хранится только его хеш). */
    public function __construct(public string $token) {}

    /**
     * Канал доставки — электронная почта.
     *
     * @return array<int, string>
     */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    /** Ссылка вида https://сайт/#/reset?token=…&email=… */
    public static function url(string $token, string $email): string
    {
        return rtrim(config('app.url'), '/').'/#/reset?token='.urlencode($token).'&email='.urlencode($email);
    }

    /** Текст письма на русском (Laravel оформит его в HTML-шаблон с кнопкой). */
    public function toMail(object $notifiable): MailMessage
    {
        $minutes = config('auth.passwords.users.expire');

        return (new MailMessage)
            ->subject('Сброс пароля Mansur AI')
            ->greeting("Здравствуйте, {$notifiable->name}!")
            ->line('Мы получили запрос на сброс пароля для вашего аккаунта Mansur AI.')
            ->action('Задать новый пароль', self::url($this->token, $notifiable->email))
            ->line("Ссылка действует {$minutes} минут и сработает только один раз.")
            ->line('Если вы не запрашивали сброс, просто проигнорируйте это письмо — пароль не изменится.')
            ->salutation("С уважением,\nкоманда Mansur AI");
    }
}
