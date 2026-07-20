FROM golang:1.25 AS build

WORKDIR /src
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=${GOPROXY}
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/control-plane .

FROM golang:1.25
RUN groupadd --system app \
    && useradd --system --gid app --create-home app \
    && mkdir -p /app/data \
    && chown -R app:app /app
WORKDIR /app
COPY --from=build /out/control-plane /usr/local/bin/control-plane
USER app
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/control-plane"]
