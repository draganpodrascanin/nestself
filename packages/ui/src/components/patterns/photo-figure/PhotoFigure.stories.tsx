import type { Meta, StoryObj } from '@storybook/react-vite';
import { PhotoFigure } from './PhotoFigure';

const meta: Meta<typeof PhotoFigure> = {
  title: 'Patterns/PhotoFigure',
  component: PhotoFigure,
};
export default meta;

export const Default: StoryObj = {
  render: () => (
    <div className="max-w-lg">
      <PhotoFigure
        photo="family-grass"
        alt="A family relaxing on the grass"
        sizes="(max-width: 768px) 100vw, 50vw"
        caption="A moment of peace"
      />
    </div>
  ),
};

export const States: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-8 max-w-lg">
      <div>
        <p className="type-label mb-2">With caption</p>
        <PhotoFigure
          photo="family-grass"
          alt="A family relaxing on the grass"
          sizes="(max-width: 768px) 100vw, 50vw"
          caption="A moment of peace"
        />
      </div>
      <div>
        <p className="type-label mb-2">Priority (eager loading)</p>
        <PhotoFigure
          photo="family-grass"
          alt="A family relaxing on the grass"
          sizes="100vw"
          priority
        />
      </div>
      <div>
        <p className="type-label mb-2">Decorative</p>
        <PhotoFigure
          photo="family-grass"
          alt=""
          sizes="100vw"
          decorative
        />
      </div>
      <div>
        <p className="type-label mb-2">With credit</p>
        <PhotoFigure
          photo="family-grass"
          alt="A family on the grass"
          sizes="100vw"
          credit={{ author: 'Example Photographer', href: 'https://example.com', photoBy: 'Photo by' }}
        />
      </div>
    </div>
  ),
};
