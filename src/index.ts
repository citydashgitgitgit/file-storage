import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';

const BASE_PATH = process.env.STORAGE_PATH || '/var/cdn-storage';
const ENVIRONMENTS = ['production', 'development'] as const;
type Environment = typeof ENVIRONMENTS[number];

// Маппинг окружения на папки
const FOLDER_MAP: Record<Environment, string> = {
  production: 'media',
  development: 'media-dev',
};

const fastify = Fastify({
  logger: true,
  bodyLimit: 100 * 1024 * 1024, // 100MB limit
});

// Регистрация multipart для загрузки файлов
fastify.register(multipart, {
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
});

// Регистрация static для отдачи файлов
fastify.register(fastifyStatic, {
  root: BASE_PATH,
  prefix: '/',
  constraints: {},
});

// Создание директорий при старте
async function initStorage() {
  for (const env of ENVIRONMENTS) {
    const folderName = FOLDER_MAP[env];
    const dirPath = path.join(BASE_PATH, folderName);
    await fs.mkdir(dirPath, { recursive: true });
  }
}

// Валидация окружения
function validateEnvironment(env: string): env is Environment {
  return ENVIRONMENTS.includes(env as Environment);
}

// Получение пути к папке по окружению
function getFolderPath(env: Environment): string {
  return FOLDER_MAP[env];
}

// Генерация имени файла на основе UUID v4
function generateFileName(originalName: string): string {
  const ext = path.extname(originalName);
  const uuid = randomUUID(); // UUID v4
  return `${uuid}${ext}`;
}

// Декодирование base64 в Buffer
function decodeBase64(base64String: string): Buffer {
  const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (matches && matches.length === 3) {
    return Buffer.from(matches[2], 'base64');
  }
  return Buffer.from(base64String, 'base64');
}

// POST: Загрузка файла
fastify.post('/upload', async (request, reply) => {
  try {
    const data = await request.file();
    
    if (!data) {
      return reply.code(400).send({ 
        error: 'No file provided',
        message: 'File is required in multipart/form-data or JSON with base64' 
      });
    }

    // Получаем environment из полей
    const envField = data.fields.environment;
    const env = (typeof envField === 'object' && envField !== null && 'value' in envField 
      ? envField.value 
      : envField) as string || 'development';
    
    if (!validateEnvironment(env)) {
      return reply.code(400).send({ 
        error: 'Invalid environment',
        message: `Environment must be one of: ${ENVIRONMENTS.join(', ')}` 
      });
    }

    const folderName = getFolderPath(env);
    const fileName = generateFileName(data.filename);
    const filePath = path.join(BASE_PATH, folderName, fileName);

    await pipeline(data.file, createWriteStream(filePath));

    return reply.code(201).send({
      success: true,
      fileName,
      environment: env,
      folder: folderName,
      url: `https://cdn.citydash.kz/${folderName}/${fileName}`,
    });
  } catch (error) {
    fastify.log.error(error);
    return reply.code(500).send({ error: 'Failed to upload file' });
  }
});

// POST: Загрузка файла через JSON (base64)
fastify.post<{
  Body: {
    file: string;
    fileName: string;
    environment?: Environment;
  };
}>('/upload/base64', async (request, reply) => {
  try {
    const { file, fileName, environment = 'development' } = request.body;

    if (!file || !fileName) {
      return reply.code(400).send({ 
        error: 'Missing required fields',
        message: 'file (base64) and fileName are required' 
      });
    }

    if (!validateEnvironment(environment)) {
      return reply.code(400).send({ 
        error: 'Invalid environment',
        message: `Environment must be one of: ${ENVIRONMENTS.join(', ')}` 
      });
    }

    const buffer = decodeBase64(file);
    const folderName = getFolderPath(environment);
    const safeFileName = generateFileName(fileName);
    const filePath = path.join(BASE_PATH, folderName, safeFileName);

    await fs.writeFile(filePath, buffer);

    return reply.code(201).send({
      success: true,
      fileName: safeFileName,
      environment,
      folder: folderName,
      url: `https://cdn.citydash.kz/${folderName}/${safeFileName}`,
    });
  } catch (error) {
    fastify.log.error(error);
    return reply.code(500).send({ error: 'Failed to upload file' });
  }
});

// GET: Получение файла
fastify.get<{
  Params: {
    folder: string;
    fileName: string;
  };
}>('/:folder/:fileName', async (request, reply) => {
  try {
    const { folder, fileName } = request.params;

    // Проверяем что папка валидна
    if (folder !== 'media' && folder !== 'media-dev') {
      return reply.code(400).send({ error: 'Invalid folder path' });
    }

    const filePath = path.join(BASE_PATH, folder, fileName);

    try {
      await fs.access(filePath);
      
      // Отправляем файл как stream
      const stream = createReadStream(filePath);
      return reply.type('application/octet-stream').send(stream);
    } catch {
      return reply.code(404).send({ error: 'File not found' });
    }
  } catch (error) {
    fastify.log.error(error);
    return reply.code(500).send({ error: 'Failed to retrieve file' });
  }
});

// DELETE: Удаление файла
fastify.delete<{
  Params: {
    folder: string;
    fileName: string;
  };
}>('/:folder/:fileName', async (request, reply) => {
  try {
    const { folder, fileName } = request.params;

    // Проверяем что папка валидна
    if (folder !== 'media' && folder !== 'media-dev') {
      return reply.code(400).send({ error: 'Invalid folder path' });
    }

    const filePath = path.join(BASE_PATH, folder, fileName);

    try {
      await fs.access(filePath);
      await fs.unlink(filePath);
      
      return reply.send({
        success: true,
        message: 'File deleted successfully',
      });
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return reply.code(404).send({ 
          error: 'File not found',
          message: 'File does not exist or already deleted' 
        });
      }
      throw error;
    }
  } catch (error) {
    fastify.log.error(error);
    return reply.code(500).send({ error: 'Failed to delete file' });
  }
});

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Запуск сервера
const start = async () => {
  try {
    await initStorage();
    await fastify.listen({ port: 3050, host: '0.0.0.0' });
    console.log('🚀 File storage server running on http://0.0.0.0:3050');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();