FROM node:22-bookworm-slim
WORKDIR /app
ENV ONNXRUNTIME_NODE_INSTALL=skip
ENV ENCLAVE_HOST=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY contract/package.json contract/package.json
COPY sdk/package.json sdk/package.json
COPY enclave/package.json enclave/package.json
RUN npm ci --include=dev
COPY contract contract
COPY sdk sdk
COPY src/engines src/engines
COPY enclave enclave
RUN npm run build --workspace @voynich/contract && npm run build --workspace voynich && npm run build --workspace voynich-enclave
EXPOSE 9707
CMD ["node", "enclave/dist/runtime.js"]
