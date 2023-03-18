import { NestFactory } from '@nestjs/core'
import { Transport } from '@nestjs/microservices'
import { AppModule } from './app.module'
import Logger from './services/logger'

async function bootstrap() {
  const app = await NestFactory.createMicroservice(
    AppModule,
    {
      logger: new Logger(),
      transport: Transport.TCP,
      options: {
        port: 3000
      }
    },
  )

  app.listen()
}

bootstrap()
