import { prisma } from "../db/prisma";

export async function addEmbassy(guildId: string, channelId: string, allianceRoleId: string, label?: string) {
  return prisma.embassyChannel.upsert({
    where: { guildId_channelId: { guildId, channelId } },
    update: { allianceRoleId, label },
    create: { guildId, channelId, allianceRoleId, label },
  });
}

export async function removeEmbassy(guildId: string, channelId: string) {
  return prisma.embassyChannel.delete({ where: { guildId_channelId: { guildId, channelId } } }).catch(() => null);
}

export async function listEmbassies(guildId: string) {
  return prisma.embassyChannel.findMany({ where: { guildId } });
}
