FROM golang:1.21-alpine AS builder

WORKDIR /src

COPY server/go.mod server/go.sum ./server/

WORKDIR /src/server
RUN go mod download

WORKDIR /src
COPY server ./server

WORKDIR /src/server
RUN CGO_ENABLED=0 \
    go build -trimpath -ldflags="-s -w" -o /out/office-shooter .

FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app/server

COPY --from=builder /out/office-shooter ./office-shooter
COPY client /app/client

ENV PORT=8080

EXPOSE 8080

ENTRYPOINT ["./office-shooter"]
