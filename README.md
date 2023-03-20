# chat-gpt-telegram-bot

> Nest TS  
> telegram-bot-api  
> openai  

Getting OpenAI API Key: https://platform.openai.com/account/api-keys  

```txt
start - Запуск
clear_context - Забыть контекст разговора
ping - Ping
```

## Installation

```bash
make cp-env
```

##### After you must configure your app in .env file

```bash
make install
```

View docker container logs

```bash
make logs
```

## Build Setup

### Production

```bash
make
```

### Building for production

To building for production you need to change `COMPOSE_FILE` param in *.env* to *docker-compose.prod.yml* and follow the above steps

### Development

```bash
make dev
```
