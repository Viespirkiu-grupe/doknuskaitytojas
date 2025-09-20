# Dokumentų nuskaitytojas

## Running in Docker

1. Copy [env.example](env.example) to `.env`

    ```shell
    cp env.example .env
    ```

2. Generate API key

    ```shell
    uuidgen | tr '[:upper:]' '[:lower:]' | sed 's/-//g'
    ```

3. Set `PORT` and `API_KEY` in `.env`

    ```shell
    PORT=3000 # If not specified, defaults to 3000
    API_KEY=your_api_key_here # Your API key from step #2
    ```

4. Run the service

    ```shell
    docker compose up -d
    ```

    In older systems it might be

    ```shell
    docker-compose up -d
    ```

5. Check if it is working as expected

    ```shell
    curl 'http://localhost:3000/?url=https%3A%2F%2Ffailai.viespirkiai.top%2F2007731419%2F2007731420&apiKey=your_api_key_here'
    ```

    Do not forget to pass your actual API key in the URL!

## Final notes

To stop the service use `docker compose down` or `docker-compose down`.

To rebuild the container, if you made code changes: `docker compose up -d --build` or `docker-compose up -d --build`.

`docker` can be easily replaced with `podman` in all of the examples above, if that is your jam. Both were tested and working.

## Get in touch

Exposing the service over the public internet is beyond the scope of this document, but do [reach out](https://viespirkiai.top/kontaktai) if you want to contribute a node and need help.
