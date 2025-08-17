import { Request, Response } from 'express';
import Event from './model';
import { EventData } from '../../types/event.types';

class EventController {
  // Create a new event
  static async createEvent(req: Request, res: Response): Promise<void> {
    try {
      const { name, date, picture } = req.body;

      // Validate required fields
      if (!name || !date) {
        res.status(400).json({
          success: false,
          message: 'Name and date are required',
          error: 'Missing required fields'
        });
        return;
      }

      // Validate date format
      if (isNaN(Date.parse(date))) {
        res.status(400).json({
          success: false,
          message: 'Invalid date format',
          error: 'Date must be a valid ISO string'
        });
        return;
      }

      // Validate base64 picture if provided
      if (picture && !picture.startsWith('data:image/')) {
        res.status(400).json({
          success: false,
          message: 'Invalid picture format. Must be a base64 encoded image',
          error: 'Picture must start with data:image/'
        });
        return;
      }

      // Create event data
      const eventData: EventData = {
        name,
        date,
        picture
      };

      const event = await Event.createEvent(eventData);

      res.status(201).json({
        success: true,
        message: 'Event created successfully',
        data: event.toObject()
      });

    } catch (error: any) {
      console.error('Error in createEvent:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  // Get event by ID 
  static async getEventById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          success: false,
          message: 'Event ID is required',
          error: 'Missing event ID parameter'
        });
        return;
      }

      const event = await Event.getEventById(id);

      if (!event) {
        res.status(404).json({
          success: false,
          message: 'Event not found',
          error: 'No event found with the provided ID'
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Event retrieved successfully',
        data: event.toObject()
      });

    } catch (error: any) {
      console.error('Error in getEventById:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  // Get all events with pagination and filtering (OPTIONAL)
  static async getAllEvents(req: Request, res: Response): Promise<void> {
    try {
      const query = req.query;
      const limit = parseInt(String(query.limit) || '50') || 50;
      const startAfter = query.startAfter as string;
      const orderBy = (query.orderBy as string) || 'date';
      const order = (query.order as string) || 'desc';

      // Validate orderBy field
      const validOrderFields = ['date', 'createdAt', 'name'];
      if (!validOrderFields.includes(orderBy)) {
        res.status(400).json({
          success: false,
          message: 'Invalid orderBy field',
          error: `orderBy must be one of: ${validOrderFields.join(', ')}`
        });
        return;
      }

      // Validate order direction
      if (order !== 'asc' && order !== 'desc') {
        res.status(400).json({
          success: false,
          message: 'Invalid order direction',
          error: 'order must be either "asc" or "desc"'
        });
        return;
      }

      const events = await Event.getAllEvents(limit, startAfter, orderBy, order);

      res.status(200).json({
        success: true,
        message: 'Events retrieved successfully',
        data: events.map(event => event.toObject())
      });

    } catch (error: any) {
      console.error('Error in getAllEvents:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  // Get upcoming events
  static async getUpcomingEvents(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 50;

      const events = await Event.getUpcomingEvents(limit);

      res.status(200).json({
        success: true,
        message: 'Upcoming events retrieved successfully',
        data: events.map(event => event.toObject())
      });

    } catch (error: any) {
      console.error('Error in getUpcomingEvents:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  // Get past events
  static async getPastEvents(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 50;

      const events = await Event.getPastEvents(limit);

      res.status(200).json({
        success: true,
        message: 'Past events retrieved successfully',
        data: events.map(event => event.toObject())
      });

    } catch (error: any) {
      console.error('Error in getPastEvents:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  // Update an event (OPTIONAL)
  static async updateEvent(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { name, date, picture } = req.body;

      if (!id) {
        res.status(400).json({
          success: false,
          message: 'Event ID is required',
          error: 'Missing event ID parameter'
        });
        return;
      }

      // Validate date format if provided
      if (date && isNaN(Date.parse(date))) {
        res.status(400).json({
          success: false,
          message: 'Invalid date format',
          error: 'Date must be a valid ISO string'
        });
        return;
      }

      // Validate base64 picture if provided
      if (picture && !picture.startsWith('data:image/')) {
        res.status(400).json({
          success: false,
          message: 'Invalid picture format. Must be a base64 encoded image',
          error: 'Picture must start with data:image/'
        });
        return;
      }

      // Get existing event
      const existingEvent = await Event.getEventById(id);
      if (!existingEvent) {
        res.status(404).json({
          success: false,
          message: 'Event not found',
          error: 'No event found with the provided ID'
        });
        return;
      }

      // Prepare update data
      const updateData: Partial<EventData> = {};
      if (name !== undefined) updateData.name = name;
      if (date !== undefined) updateData.date = date;
      if (picture !== undefined) updateData.picture = picture;

      const updatedEvent = await existingEvent.updateEvent(updateData);

      res.status(200).json({
        success: true,
        message: 'Event updated successfully',
        data: updatedEvent.toObject()
      });

    } catch (error: any) {
      console.error('Error in updateEvent:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  // Delete an event
  static async deleteEvent(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          success: false,
          message: 'Event ID is required',
          error: 'Missing event ID parameter'
        });
        return;
      }

      const event = await Event.getEventById(id);
      if (!event) {
        res.status(404).json({
          success: false,
          message: 'Event not found',
          error: 'No event found with the provided ID'
        });
        return;
      }

      await event.deleteEvent();

      res.status(200).json({
        success: true,
        message: 'Event deleted successfully'
      });

    } catch (error: any) {
      console.error('Error in deleteEvent:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }

  // Search events by name(OPTIONAL)
  static async searchEventsByName(req: Request, res: Response): Promise<void> {
    try {
      const { q } = req.query;
      const limit = parseInt(req.query.limit as string) || 20;

      if (!q || typeof q !== 'string') {
        res.status(400).json({
          success: false,
          message: 'Search query is required',
          error: 'Missing or invalid search query parameter "q"'
        });
        return;
      }

      const events = await Event.searchEventsByName(q, limit);

      res.status(200).json({
        success: true,
        message: 'Events search completed successfully',
        data: events.map(event => event.toObject())
      });

    } catch (error: any) {
      console.error('Error in searchEventsByName:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
}

export default EventController;
