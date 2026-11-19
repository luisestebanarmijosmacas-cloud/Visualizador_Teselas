// Catálogo público. Duplica un objeto para registrar cada modelo 3D Tiles adicional.
// La URL puede ser relativa (al repositorio) o absoluta (servidor compatible con CORS).
window.GEOBIM_MODELS = [
  {
    id: "demo",
    name: "Infraestructura hidráulica · DEMO",
    category: "EJEMPLO INCLUIDO",
    location: "Modelo conceptual (datos ficticios)",
    year: "2026",
    format: "3D Tiles 1.1",
    projection: "WGS84 / ECEF",
    description: "Escena 3D sintética, creada únicamente para comprobar el visor. No representa una central hidroeléctrica real.",
    url: "modelos/demo/tileset.json"
  }

  // EJEMPLO PARA AÑADIR UN PROYECTO REAL:
  // ,{
  //   id: "captacion-pilaton",
  //   name: "Captación Pilatón · Levantamiento RPAS",
  //   category: "FOTOGRAMETRÍA",
  //   location: "Ecuador",
  //   year: "2026",
  //   format: "3D Tiles",
  //   projection: "WGS84",
  //   description: "Modelo teselado del levantamiento fotogramétrico.",
  //   url: "modelos/pilaton/tileset.json"
  // }
];
