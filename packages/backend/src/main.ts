import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TasksService } from './tasks/tasks.service';
import { getAllowedOrigins } from './config/runtime';

async function bootstrap() {
  try {
    // Логируем переменные окружения (только ключи)
    console.log('Environment variables:', {
      keys: Object.keys(process.env),
      bot_token_length: process.env.BOT_TOKEN?.length
    });

    const app = await NestFactory.create(AppModule);
    
    app.enableCors({
      origin: getAllowedOrigins(),
      methods: ['GET', 'POST'],
      credentials: true,
    });

    app.setGlobalPrefix('api');

    // Логируем все маршруты
    const server = app.getHttpServer();
    const router = server._events.request._router;
    console.log('Registered routes:');
    router.stack.forEach((route) => {
      if (route.route) {
        console.log(`${route.route.stack[0].method.toUpperCase()} ${route.route.path}`);
      }
    });

    // Инициализируем первое задание
    const tasksService = app.get(TasksService);
    await tasksService.initDefaultTasks();

    await app.listen(3005);
    console.log('Application started on port 3005');
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

bootstrap(); 
