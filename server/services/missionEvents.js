// Diffusion temps réel des changements de mission vers toutes les parties concernées :
// commerçant (donneur d'ordre) et client destinataire (si la mission est liée à un compte).
const { db } = require('../db');

/** Mission complète (noms inclus) pour les payloads socket */
function missionWithNames(id) {
  return db.prepare(`
    SELECT m.*, c.name AS commercant_name, l.name AS livreur_name
    FROM missions m
    JOIN users c ON c.id = m.commercant_id
    LEFT JOIN users l ON l.id = m.livreur_id
    WHERE m.id = ?`).get(id);
}

/**
 * Notifie un changement de statut.
 * - commerçant : "mission:status-update" (+ "mission:completed" si livrée)
 * - client lié : "mission:status-update" (+ "mission:completed-client" si livrée)
 * extra : champs ajoutés au payload (ex. livreurName)
 */
function emitMissionStatus(io, missionId, extra = {}) {
  if (!io) return;
  const mission = missionWithNames(missionId);
  if (!mission) return;
  const payload = { missionId: mission.id, status: mission.status, mission, livreurName: mission.livreur_name, ...extra };
  io.to(`user:${mission.commercant_id}`).emit('mission:status-update', payload);
  if (mission.status === 'livree') io.to(`user:${mission.commercant_id}`).emit('mission:completed', payload);
  if (mission.client_id) {
    io.to(`user:${mission.client_id}`).emit('mission:status-update', payload);
    if (mission.status === 'livree') io.to(`user:${mission.client_id}`).emit('mission:completed-client', payload);
  }
  return mission;
}

/** Nouvelle mission : livreur ("mission:new") + client lié ("mission:new-client") */
function emitMissionCreated(io, missionId) {
  if (!io) return;
  const mission = missionWithNames(missionId);
  if (!mission) return;
  io.to(`user:${mission.livreur_id}`).emit('mission:new', { mission });
  if (mission.client_id) io.to(`user:${mission.client_id}`).emit('mission:new-client', { mission });
  return mission;
}

module.exports = { missionWithNames, emitMissionStatus, emitMissionCreated };
