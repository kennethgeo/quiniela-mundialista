# Imagen base para el backend de Quiniela Mundialista
FROM python:3.12-slim

WORKDIR /app

# Instalar dependencias del proyecto
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código fuente de la aplicación
COPY . .

# Exponer el puerto de la API
EXPOSE 8000

# Comando de inicio con uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
