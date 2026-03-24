FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5073

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5073"]
