// Autopilot: fill the screen on display, verify it, press "Siguiente", repeat until
// "Términos y condiciones". Never accepts terms, never submits. No Chrome APIs here, so the
// same loop runs in the side panel and in the local test page (tools/mock-invimagil-flujo.html).
(function (global) {
  const clase = (r) => (r.estado === 'ok' || r.estado === 'simulado' ? 'ok' : r.estado === 'vacio' ? 'pend' : 'mal');
  function contar(resultados) {
    const c = { ok: 0, mal: 0, pend: 0 };
    const walk = (r) => { c[clase(r)]++; (r.sub || []).forEach(walk); };
    (resultados || []).forEach(walk);
    return c;
  }
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

  // opts: send(msg) -> Promise<response> (rejects while the page reloads), planilla, requestId,
  // documentos, detenerEnProblemas, onPaso(res), onEstado(texto), debeParar() -> bool
  async function correr(opts) {
    const { send, onPaso = async () => {}, onEstado = () => {}, debeParar = () => false } = opts;
    const visitados = [];
    async function estado(maxMs = 20000) {
      const t0 = Date.now();
      for (;;) {
        try { const st = await send({ type: 'ESTADO' }); if (st && st.ok) return st; } catch { /* page loading */ }
        if (Date.now() - t0 > maxMs) return null;
        await dormir(500);
      }
    }
    for (let vuelta = 0; vuelta < 16; vuelta++) {
      if (debeParar()) return { fin: 'pausado', visitados };
      const st = await estado();
      if (!st) return { fin: 'error', error: 'La pestaña de InvimÁgil no responde.', visitados };
      if (!st.pasoId) return { fin: 'desconocida', error: 'No reconozco la pantalla «' + (st.encabezado || st.url) + '».', visitados };
      if (st.pasoId === 'terminos') return { fin: 'terminos', visitados };
      if (visitados.filter((v) => v.paso === st.pasoId).length >= 2) return { fin: 'no-avanza', error: `La pantalla «${st.paso}» se repite.`, visitados };
      onEstado(`Llenando «${st.paso}»…`);
      const res = await send({ type: 'FILL_STEP', pasoId: st.pasoId, planilla: opts.planilla, requestId: opts.requestId, documentos: opts.documentos });
      if (!res || !res.ok) return { fin: 'error', error: (res && res.error) || 'sin respuesta', visitados };
      visitados.push(res);
      await onPaso(res);
      const c = contar(res.resultados);
      if (debeParar()) return { fin: 'pausado', visitados };
      if (opts.detenerEnProblemas && c.mal > 0) return { fin: 'problemas', paso: res.titulo, conteo: c, visitados };
      onEstado(`«${res.titulo}» lista (${c.ok} ok · ${c.mal} con problema · ${c.pend} sin dato). Siguiente…`);
      let nx = null;
      try { nx = await send({ type: 'SIGUIENTE', desde: st.pasoId }); } catch { nx = null; }
      if (!nx) { // the page reloaded while moving on
        const st2 = await estado();
        nx = st2 && st2.pasoId && st2.pasoId !== st.pasoId ? { ok: true, hacia: st2.pasoId } : { ok: false, error: 'La página se recargó y no avanzó.' };
      }
      if (!nx.ok) return { fin: 'no-avanza', paso: res.titulo, error: nx.error, errores: nx.errores || [], visitados };
      await dormir(400);
    }
    return { fin: 'limite', visitados };
  }

  const MENSAJES = {
    terminos: 'Llegó a Términos y condiciones. Revise el borrador, acepte los términos y radique usted.',
    pausado: 'Pausado. Puede corregir a mano y pulsar de nuevo para seguir desde esta pantalla.',
    problemas: 'Se detuvo porque esta pantalla tiene campos con problema. Corríjalos a mano y pulse de nuevo para seguir.',
    'no-avanza': 'La plataforma no dejó pasar a la siguiente pantalla.',
    desconocida: 'La pantalla actual no está en el mapa.',
    error: 'Error.',
    limite: 'Se detuvo por seguridad tras demasiadas pantallas.',
  };
  global.Autopiloto = { correr, contar, clase, MENSAJES };
})(typeof window !== 'undefined' ? window : globalThis);
