import { Router } from 'express';
import EventController from './controller';

const eventRouter = Router();

// Create a new event
// POST /api/events
// Body: { name: string, date: string, picture?: string }
// Picture should be base64 encoded image string
eventRouter.post('/', EventController.createEvent);

// Get event by ID
// GET /api/events/:id
eventRouter.get('/:id', EventController.getEventById);

// Search events by name (this needs to be before the general GET / route)
// GET /api/events/search?q=searchterm&limit=20
eventRouter.get('/search', EventController.searchEventsByName);

// Get upcoming events
// GET /api/events/upcoming
eventRouter.get('/upcoming', EventController.getUpcomingEvents);

// Get past events
// GET /api/events/past  
eventRouter.get('/past', EventController.getPastEvents);

// Get all events with optional pagination and filtering
// GET /api/events
// Query params: limit, startAfter, orderBy (date|createdAt|name), order (asc|desc)
eventRouter.get('/', EventController.getAllEvents);

// Update an event
// PUT /api/events/:id
// Body: { name?: string, date?: string, picture?: string }
// Picture should be base64 encoded image string
eventRouter.put('/:id', EventController.updateEvent);

// Delete an event
// DELETE /api/events/:id
eventRouter.delete('/:id', EventController.deleteEvent);

export default eventRouter;
