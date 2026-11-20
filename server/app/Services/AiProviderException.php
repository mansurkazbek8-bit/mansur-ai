<?php

namespace App\Services;

use RuntimeException;

/**
 * Своё исключение: внешняя нейросеть не ответила (таймаут, ошибка 5xx, пустой или неверный ответ).
 * Его ловят MessageService и AgentTaskService: откатывают транзакцию (лимит не списывается)
 * и пробуют запасную модель или возвращают пользователю ответ 502.
 */
class AiProviderException extends RuntimeException {}
