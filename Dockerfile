FROM alpine:latest

ARG TARGETPLATFORM

RUN apk add --no-cache tzdata nodejs npm ffmpeg imagemagick libheif
RUN if [ "$TARGETPLATFORM" = "linux/amd64" ]; then \
        apk add libva-intel-driver; \
    fi

COPY . /app
WORKDIR /app
RUN npm install --omit=dev
RUN chmod +x entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
