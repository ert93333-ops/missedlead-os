import type { Express } from 'express';
import { z } from 'zod';
import { featureClient, featureError } from '../context.js';

const uuid = z.string().uuid();
const organizationInput = z.object({ name: z.string().trim().min(1).max(120) });
const locationInput = organizationInput.extend({ address: z.string().trim().min(5).max(500) });
const memberInput = z.object({ profileId: uuid, role: z.enum(['member', 'approver']) });
const requestInput = z.object({ requestId: uuid, locationId: uuid, businessInterruption: z.boolean(), impactNote: z.string().trim().max(2000) });
const approvalInput = z.object({ quoteId: uuid });
const decisionInput = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().min(1).max(2000) });

export function registerBusinessRoutes(app: Express) {
  app.get('/api/business/organizations', async (req, res) => {
    try {
      const { data, error } = await featureClient(req).from('business_organizations').select('*').order('created_at');
      if (error) throw error;
      res.json({ organizations: data });
    } catch (error) { featureError(res, error); }
  });
  app.post('/api/business/organizations', async (req, res) => {
    try {
      const body = organizationInput.parse(req.body);
      const { data, error } = await featureClient(req).rpc('business_create_organization', { p_name: body.name } ).single();
      if (error) throw error;
      res.status(201).json({ organization: data });
    } catch (error) { featureError(res, error); }
  });
  app.get('/api/business/organizations/:orgId', async (req, res) => {
    try {
      const orgId = uuid.parse(req.params.orgId);
      const client = featureClient(req);
      const [organization, members, locations, requests, approvals] = await Promise.all([
        client.from('business_organizations').select('*').eq('id', orgId).single(),
        client.from('business_members').select('*').eq('organization_id', orgId).order('created_at'),
        client.from('business_locations').select('*').eq('organization_id', orgId).order('created_at'),
        client.from('business_requests').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
        client.from('business_approvals').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
      ]);
      for (const result of [organization, members, locations, requests, approvals]) if (result.error) throw result.error;
      res.json({ organization: organization.data, members: members.data, locations: locations.data, requests: requests.data, approvals: approvals.data });
    } catch (error) { featureError(res, error); }
  });
  app.post('/api/business/organizations/:orgId/members', async (req, res) => {
    try {
      const orgId = uuid.parse(req.params.orgId);
      const body = memberInput.parse(req.body);
      const { data, error } = await featureClient(req).rpc('business_set_member', { p_org: orgId, p_profile: body.profileId, p_role: body.role } ).single();
      if (error) throw error;
      res.json({ member: data });
    } catch (error) { featureError(res, error); }
  });
  app.post('/api/business/organizations/:orgId/locations', async (req, res) => {
    try {
      const orgId = uuid.parse(req.params.orgId);
      const body = locationInput.parse(req.body);
      const { data, error } = await featureClient(req).rpc('business_add_location', { p_org: orgId, p_name: body.name, p_address: body.address } ).single();
      if (error) throw error;
      res.status(201).json({ location: data });
    } catch (error) { featureError(res, error); }
  });
  app.post('/api/business/organizations/:orgId/requests', async (req, res) => {
    try {
      const orgId = uuid.parse(req.params.orgId);
      const body = requestInput.parse(req.body);
      const { data, error } = await featureClient(req).rpc('business_link_request', { p_org: orgId, p_location: body.locationId, p_request: body.requestId, p_interruption: body.businessInterruption, p_impact: body.impactNote } ).single();
      if (error) throw error;
      res.json({ request: data });
    } catch (error) { featureError(res, error); }
  });
  app.post('/api/business/organizations/:orgId/approvals', async (req, res) => {
    try {
      const orgId = uuid.parse(req.params.orgId);
      const body = approvalInput.parse(req.body);
      const { data, error } = await featureClient(req).rpc('business_request_approval', { p_org: orgId, p_quote: body.quoteId } ).single();
      if (error) throw error;
      res.json({ approval: data });
    } catch (error) { featureError(res, error); }
  });
  app.post('/api/business/approvals/:approvalId/decision', async (req, res) => {
    try {
      const approvalId = uuid.parse(req.params.approvalId);
      const body = decisionInput.parse(req.body);
      const { data, error } = await featureClient(req).rpc('business_decide_approval', { p_approval: approvalId, p_decision: body.decision, p_note: body.note } ).single();
      if (error) throw error;
      res.json({ approval: data });
    } catch (error) { featureError(res, error); }
  });
  app.get('/api/business/organizations/:orgId/report', async (req, res) => {
    try {
      const orgId = uuid.parse(req.params.orgId);
      const year = z.coerce.number().int().min(2000).max(2100).parse(req.query.year);
      const { data, error } = await featureClient(req).rpc('business_annual_report', { p_org: orgId, p_year: year });
      if (error) throw error;
      res.json({ report: data });
    } catch (error) { featureError(res, error); }
  });
  app.get('/api/notifications', async (req, res) => {
    try {
      const { data, error } = await featureClient(req).from('user_notifications').select('id,recipient_id,request_id,kind,title,body,created_at,read_at').order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      res.json({ notifications: data });
    } catch (error) { featureError(res, error); }
  });
  app.post('/api/notifications/:notificationId/read', async (req, res) => {
    try {
      const notificationId = uuid.parse(req.params.notificationId);
      const { data, error } = await featureClient(req).rpc('notification_mark_read', { p_notification: notificationId } ).single();
      if (error) throw error;
      res.json({ notification: data });
    } catch (error) { featureError(res, error); }
  });
}
