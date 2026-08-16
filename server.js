require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const CACHE_MS = Math.max(1, Number(process.env.CACHE_MINUTES || 10)) * 60 * 1000;

const BARASAT = {
  name: "Barasat",
  region: "North 24 Parganas, West Bengal",
  country: "India",
  lat: 22.7210,
  lon: 88.4827,
  timezone: "Asia/Kolkata"
};

let cache = { value: null, expires: 0 };

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return null;
}

function isoHour(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BARASAT.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  }).format(date).replace(", ", "T");
}

function weatherTextFromCode(code) {
  const c = Number(code);
  const map = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Freezing drizzle",
    57: "Heavy freezing drizzle",
    61: "Light rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Heavy freezing rain",
    71: "Light snow",
    73: "Moderate snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Light rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Light snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Thunderstorm with heavy hail"
  };
  return map[c] || "Unknown";
}

async function getJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 300) }; }
    if (!response.ok) {
      const message = body?.error?.message || body?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpenMeteo() {
  const params = new URLSearchParams({
    latitude: BARASAT.lat,
    longitude: BARASAT.lon,
    timezone: BARASAT.timezone,
    forecast_days: "7",
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "rain",
      "showers",
      "weather_code",
      "cloud_cover",
      "pressure_msl",
      "surface_pressure",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m"
    ].join(","),
    hourly: [
      "temperature_2m",
      "relative_humidity_2m",
      "dew_point_2m",
      "apparent_temperature",
      "precipitation_probability",
      "precipitation",
      "rain",
      "showers",
      "weather_code",
      "cloud_cover",
      "visibility",
      "pressure_msl",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
      "uv_index"
    ].join(","),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "apparent_temperature_max",
      "apparent_temperature_min",
      "sunrise",
      "sunset",
      "daylight_duration",
      "precipitation_sum",
      "rain_sum",
      "showers_sum",
      "precipitation_probability_max",
      "wind_speed_10m_max",
      "wind_gusts_10m_max",
      "uv_index_max"
    ].join(",")
  });

  const data = await getJson(`https://api.open-meteo.com/v1/forecast?${params}`);

  return {
    provider: "Open-Meteo",
    status: "ok",
    fetchedAt: new Date().toISOString(),
    raw: data,
    current: {
      temp: num(data.current?.temperature_2m),
      feels: num(data.current?.apparent_temperature),
      humidity: num(data.current?.relative_humidity_2m),
      pressure: num(data.current?.pressure_msl),
      wind: num(data.current?.wind_speed_10m),
      gust: num(data.current?.wind_gusts_10m),
      windDir: num(data.current?.wind_direction_10m),
      cloud: num(data.current?.cloud_cover),
      precip: num(data.current?.precipitation),
      code: num(data.current?.weather_code),
      condition: weatherTextFromCode(data.current?.weather_code)
    },
    hourly: data.hourly,
    daily: data.daily
  };
}

async function fetchWeatherAPI() {
  if (!process.env.WEATHERAPI_KEY) {
    return { provider: "WeatherAPI.com", status: "not_configured", error: "WEATHERAPI_KEY is not set" };
  }

  const params = new URLSearchParams({
    key: process.env.WEATHERAPI_KEY,
    q: `${BARASAT.lat},${BARASAT.lon}`,
    days: "3",
    aqi: "yes",
    alerts: "yes"
  });

  const data = await getJson(`https://api.weatherapi.com/v1/forecast.json?${params}`);

  return {
    provider: "WeatherAPI.com",
    status: "ok",
    fetchedAt: new Date().toISOString(),
    raw: data,
    current: {
      temp: num(data.current?.temp_c),
      feels: num(data.current?.feelslike_c),
      humidity: num(data.current?.humidity),
      pressure: num(data.current?.pressure_mb),
      wind: num(data.current?.wind_kph),
      gust: num(data.current?.gust_kph),
      windDir: num(data.current?.wind_degree),
      cloud: num(data.current?.cloud),
      precip: num(data.current?.precip_mm),
      visibility: num(data.current?.vis_km),
      uv: num(data.current?.uv),
      dew: num(data.current?.dewpoint_c),
      condition: data.current?.condition?.text || "Unknown",
      icon: data.current?.condition?.icon || null,
      isDay: data.current?.is_day
    },
    hourly: (data.forecast?.forecastday || []).flatMap(d => d.hour || []),
    daily: (data.forecast?.forecastday || []).map(d => ({
      date: d.date,
      max: d.day?.maxtemp_c,
      min: d.day?.mintemp_c,
      feelsMax: d.day?.avgtemp_c,
      rain: d.day?.totalprecip_mm,
      rainChance: d.day?.daily_chance_of_rain,
      windMax: d.day?.maxwind_kph,
      uv: d.day?.uv,
      condition: d.day?.condition?.text,
      icon: d.day?.condition?.icon,
      sunrise: d.astro?.sunrise,
      sunset: d.astro?.sunset,
      humidity: d.day?.avghumidity
    })),
    air: data.current?.air_quality || null,
    alerts: data.alerts?.alert || []
  };
}

async function fetchTomorrow() {
  if (!process.env.TOMORROW_API_KEY) {
    return { provider: "Tomorrow.io", status: "not_configured", error: "TOMORROW_API_KEY is not set" };
  }

  const fields = [
    "temperature",
    "temperatureApparent",
    "humidity",
    "dewPoint",
    "precipitationProbability",
    "precipitationIntensity",
    "rainIntensity",
    "weatherCode",
    "cloudCover",
    "pressureSurfaceLevel",
    "windSpeed",
    "windGust",
    "windDirection",
    "visibility",
    "uvIndex"
  ].join(",");

  const params = new URLSearchParams({
    location: `${BARASAT.lat},${BARASAT.lon}`,
    timesteps: "1h,1d",
    units: "metric",
    fields,
    apikey: process.env.TOMORROW_API_KEY
  });

  const data = await getJson(`https://api.tomorrow.io/v4/weather/forecast?${params}`);

  const timelines = data.timelines || {};
  const hourly = Array.isArray(timelines.hourly)
    ? timelines.hourly
    : [];
  const daily = Array.isArray(timelines.daily)
    ? timelines.daily
    : [];

  const currentPoint = hourly[0]?.values || {};

  return {
    provider: "Tomorrow.io",
    status: "ok",
    fetchedAt: new Date().toISOString(),
    raw: data,
    current: {
      temp: num(currentPoint.temperature),
      feels: num(currentPoint.temperatureApparent),
      humidity: num(currentPoint.humidity),
      pressure: num(currentPoint.pressureSurfaceLevel),
      wind: num(currentPoint.windSpeed),
      gust: num(currentPoint.windGust),
      windDir: num(currentPoint.windDirection),
      cloud: num(currentPoint.cloudCover),
      precip: num(currentPoint.precipitationIntensity),
      visibility: num(currentPoint.visibility),
      uv: num(currentPoint.uvIndex),
      dew: num(currentPoint.dewPoint),
      rainChance: num(currentPoint.precipitationProbability),
      code: num(currentPoint.weatherCode),
      condition: weatherTextFromCode(currentPoint.weatherCode)
    },
    hourly,
    daily
  };
}

function safeProviderError(name, err) {
  return {
    provider: name,
    status: "error",
    error: err?.message || String(err)
  };
}

function median(values) {
  const v = values.filter(Number.isFinite).sort((a,b) => a-b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m-1] + v[m]) / 2;
}

function buildConsensus(providers) {
  const ok = providers.filter(p => p.status === "ok");
  const temps = ok.map(p => p.current?.temp).filter(Number.isFinite);
  const feels = ok.map(p => p.current?.feels).filter(Number.isFinite);
  const humidity = ok.map(p => p.current?.humidity).filter(Number.isFinite);
  const wind = ok.map(p => p.current?.wind).filter(Number.isFinite);
  const pressure = ok.map(p => p.current?.pressure).filter(Number.isFinite);
  const rain = ok.map(p => p.current?.precip).filter(Number.isFinite);

  return {
    providersOnline: ok.length,
    temp: median(temps),
    feels: median(feels),
    humidity: median(humidity),
    wind: median(wind),
    pressure: median(pressure),
    precip: median(rain),
    tempSpread: temps.length > 1 ? Math.max(...temps) - Math.min(...temps) : 0,
    condition: ok[0]?.current?.condition || "Unavailable"
  };
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    location: BARASAT,
    providers: {
      openMeteo: true,
      weatherApi: Boolean(process.env.WEATHERAPI_KEY),
      tomorrow: Boolean(process.env.TOMORROW_API_KEY)
    }
  });
});

app.get("/api/weather/all", async (req, res) => {
  if (cache.value && Date.now() < cache.expires) {
    return res.json({ ...cache.value, cached: true, cacheExpires: cache.expires });
  }

  const results = await Promise.allSettled([
    fetchOpenMeteo(),
    fetchWeatherAPI(),
    fetchTomorrow()
  ]);

  const providers = results.map((r, i) => {
    const names = ["Open-Meteo", "WeatherAPI.com", "Tomorrow.io"];
    return r.status === "fulfilled" ? r.value : safeProviderError(names[i], r.reason);
  });

  const payload = {
    location: BARASAT,
    generatedAt: new Date().toISOString(),
    cached: false,
    cacheMinutes: Number(process.env.CACHE_MINUTES || 10),
    providers,
    consensus: buildConsensus(providers)
  };

  cache = { value: payload, expires: Date.now() + CACHE_MS };
  res.json(payload);
});

app.use(express.static(path.join(__dirname, "public")));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Barasat Weather running on http://0.0.0.0:${PORT}`);
});
